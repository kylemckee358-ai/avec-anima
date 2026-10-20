/**
 * Avec Anima local dev + admin server
 * Run with: node server.js (from the Avec Anima/ directory)
 *
 * Serves the static site AND the admin API. The admin page (website/admin.html)
 * needs this running to actually save changes — a plain static file server
 * (e.g. `python3 -m http.server`) can browse the site but can't write anything.
 *
 * Every mutating endpoint below rebuilds assets/events/manifest.json before
 * responding, so the public site reflects changes immediately on refresh.
 *
 * API:
 *   GET    /api/events                          — list all events (upcoming + previous)
 *   GET    /api/events/:category/:slug          — single event, raw fields
 *   POST   /api/events                          — create event (multipart: poster file + fields)
 *   PUT    /api/events/:category/:slug          — edit core fields (json body)
 *   POST   /api/events/:category/:slug/poster   — replace poster (multipart: poster file)
 *   POST   /api/events/:category/:slug/lineup   — add lineup artist (multipart: name + photo)
 *   DELETE /api/events/:category/:slug/lineup/:index — remove lineup artist by index
 *   POST   /api/events/:category/:slug/move     — move upcoming <-> previous (json: { toCategory })
 *   DELETE /api/events/:category/:slug          — delete event entirely
 *   POST   /api/events/:category/:slug/aftermovie — upload after movie (multipart: video), compressed with ffmpeg
 *   DELETE /api/events/:category/:slug/aftermovie — remove after movie
 *   POST   /api/events/:category/:slug/gallery  — add gallery photos (multipart: photos[])
 *   DELETE /api/events/:category/:slug/gallery/:file — remove one gallery photo
 *   GET    /api/music/videos                    — read videos.json
 *   PUT    /api/music/videos                    — overwrite videos.json (json array)
 *   GET    /api/music/soundcloud                — read soundcloud.json
 *   PUT    /api/music/soundcloud                 — overwrite soundcloud.json (json object)
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const { execFile } = require('child_process');

const {
  EVENTS_ROOT,
  slugify,
  categoryDir,
  eventDir,
  findPoster,
  readAllEvents,
  writeManifest,
  readEventDetailsRaw,
  writeEventDetailsRaw,
} = require('./lib/events-data');

const app = express();
const PORT = 4200;
const ROOT = __dirname;
const WEBSITE_DIR = path.join(ROOT, 'website');
const MUSIC_DIR = path.join(WEBSITE_DIR, 'assets', 'music');
const CATEGORIES = ['upcoming', 'previous'];

app.use(express.static(WEBSITE_DIR));
app.use(express.json());

function uniqueSlug(category, baseSlug) {
  let slug = baseSlug || 'event';
  let i = 2;
  while (fs.existsSync(eventDir(category, slug))) {
    slug = `${baseSlug}-${i}`;
    i += 1;
  }
  return slug;
}

function isValidCategory(category) {
  return CATEGORIES.includes(category);
}

// Normalizes any uploaded image format (HEIC from iPhones, PNG, WEBP, whatever)
// into a consistent JPEG, auto-rotated and capped to a sane max width. This is
// what makes upload "just work" regardless of what format a phone hands us.
// HEIC needs a dedicated decoder first — sharp's bundled libheif can't decode
// the HEVC codec real iPhone photos use (a licensing limitation, not a bug).
function isHeic(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  return ext === '.heic' || ext === '.heif' || file.mimetype === 'image/heic' || file.mimetype === 'image/heif';
}

async function saveNormalizedImage(file, destPath, maxWidth = 1600) {
  let input = file.path;
  if (isHeic(file)) {
    input = await heicConvert({ buffer: fs.readFileSync(file.path), format: 'JPEG', quality: 0.92 });
  }

  await sharp(input)
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true })
    .flatten({ background: '#0A0A0A' }) // transparent areas (e.g. PNG posters) become site-black, not white
    .jpeg({ quality: 85 })
    .toFile(destPath);

  fs.unlinkSync(file.path);
}

// Uploads land in a temp dir first (destination doesn't know the final
// category/slug yet since that depends on body fields parsed after the file).
const upload = multer({
  dest: path.join(ROOT, '.tmp-uploads'),
  limits: { fileSize: 30 * 1024 * 1024 },
});

// After movies are far bigger than images — separate limit so the image one stays tight
const videoUpload = multer({
  dest: path.join(ROOT, '.tmp-uploads'),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 },
});

// Homebrew's ffmpeg isn't on PATH when node is started from some apps, so look in the usual spots
const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => fs.existsSync(p)) || 'ffmpeg';
const MAX_VIDEO_BYTES = 95 * 1024 * 1024; // GitHub rejects files over 100 MB

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim().split('\n').pop() || err.message));
      else resolve();
    });
  });
}

// ── Events: read ──────────────────────────────────────────────────
app.get('/api/events', (req, res) => {
  res.json(readAllEvents());
});

app.get('/api/events/:category/:slug', (req, res) => {
  const { category, slug } = req.params;
  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });

  const details = readEventDetailsRaw(category, slug);
  if (!details) return res.status(404).json({ error: 'Event not found' });

  const dir = eventDir(category, slug);
  const poster = findPoster(dir);
  const lineup = (details.lineup || []).map((artist) => ({
    ...artist,
    photo: artist.photo ? `assets/events/${category}/${slug}/${artist.photo}` : null,
  }));

  res.json({
    ...details,
    slug,
    category,
    poster: poster ? `assets/events/${category}/${slug}/${poster}` : null,
    lineup,
  });
});

// ── Events: create ────────────────────────────────────────────────
// Lineup artists arrive as indexed fields from the Add Event form:
//   artistName_0 / artistPhoto_0, artistName_1 / artistPhoto_1, ...
// (a photo file is optional per artist — missing ones just get photo: null)
app.post('/api/events', upload.any(), async (req, res) => {
  const { category, name, date, startTime, endTime, location, ticketLink, description } = req.body;

  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!name || !date) return res.status(400).json({ error: 'Name and date are required' });

  const files = req.files || [];
  const posterFile = files.find((f) => f.fieldname === 'poster');
  if (!posterFile) return res.status(400).json({ error: 'Poster image is required' });

  const slug = uniqueSlug(category, slugify(name));
  const dir = eventDir(category, slug);
  fs.mkdirSync(dir, { recursive: true });

  try {
    await saveNormalizedImage(posterFile, path.join(dir, 'poster.jpg'));
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    return res.status(400).json({ error: `Couldn't read that poster image (${err.message})` });
  }

  const artistIndexes = Object.keys(req.body)
    .filter((key) => /^artistName_\d+$/.test(key))
    .map((key) => Number(key.split('_')[1]))
    .sort((a, b) => a - b);

  const lineup = [];
  if (artistIndexes.length) {
    const lineupDir = path.join(dir, 'lineup');
    fs.mkdirSync(lineupDir, { recursive: true });

    for (const i of artistIndexes) {
      const artistName = (req.body[`artistName_${i}`] || '').trim();
      if (!artistName) continue;

      const photoFile = files.find((f) => f.fieldname === `artistPhoto_${i}`);
      let photo = null;
      if (photoFile) {
        const filename = `${slugify(artistName)}.jpg`;
        try {
          await saveNormalizedImage(photoFile, path.join(lineupDir, filename));
          photo = `lineup/${filename}`;
        } catch (err) {
          // couldn't read this artist's photo — keep the artist, just without one
        }
      }
      lineup.push({ name: artistName, photo });
    }
  }

  writeEventDetailsRaw(category, slug, {
    name,
    date,
    startTime: startTime || '',
    endTime: endTime || '',
    location: location || '',
    ticketLink: ticketLink || '#',
    description: description || '',
    lineup,
  });

  writeManifest();
  res.json({ ok: true, category, slug });
});

// ── Events: edit core fields ──────────────────────────────────────
app.put('/api/events/:category/:slug', (req, res) => {
  const { category, slug } = req.params;
  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });

  const existing = readEventDetailsRaw(category, slug);
  if (!existing) return res.status(404).json({ error: 'Event not found' });

  const { name, date, startTime, endTime, location, ticketLink, description, driveLink } = req.body;
  const updated = {
    ...existing,
    name: name ?? existing.name,
    date: date ?? existing.date,
    startTime: startTime ?? existing.startTime,
    endTime: endTime ?? existing.endTime,
    location: location ?? existing.location,
    ticketLink: ticketLink ?? existing.ticketLink,
    description: description ?? existing.description,
    driveLink: driveLink ?? existing.driveLink ?? '',
  };

  writeEventDetailsRaw(category, slug, updated);
  writeManifest();
  res.json({ ok: true });
});

// ── Events: replace poster ────────────────────────────────────────
app.post('/api/events/:category/:slug/poster', upload.single('poster'), async (req, res) => {
  const { category, slug } = req.params;
  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!req.file) return res.status(400).json({ error: 'Poster image is required' });

  const dir = eventDir(category, slug);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Event not found' });

  try {
    await saveNormalizedImage(req.file, path.join(dir, '_poster-new.jpg'));
  } catch (err) {
    return res.status(400).json({ error: `Couldn't read that poster image (${err.message})` });
  }

  const existingPoster = findPoster(dir);
  if (existingPoster) fs.unlinkSync(path.join(dir, existingPoster));
  fs.renameSync(path.join(dir, '_poster-new.jpg'), path.join(dir, 'poster.jpg'));

  writeManifest();
  res.json({ ok: true });
});

// ── Events: add lineup artist ─────────────────────────────────────
app.post('/api/events/:category/:slug/lineup', upload.single('photo'), async (req, res) => {
  const { category, slug } = req.params;
  const { name } = req.body;
  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!name) return res.status(400).json({ error: 'Artist name is required' });

  const details = readEventDetailsRaw(category, slug);
  if (!details) return res.status(404).json({ error: 'Event not found' });

  let photo = null;
  if (req.file) {
    const dir = eventDir(category, slug);
    const lineupDir = path.join(dir, 'lineup');
    fs.mkdirSync(lineupDir, { recursive: true });

    const filename = `${slugify(name)}.jpg`;
    try {
      await saveNormalizedImage(req.file, path.join(lineupDir, filename));
      photo = `lineup/${filename}`;
    } catch (err) {
      return res.status(400).json({ error: `Couldn't read that photo (${err.message})` });
    }
  }

  details.lineup = [...(details.lineup || []), { name, photo }];
  writeEventDetailsRaw(category, slug, details);
  writeManifest();
  res.json({ ok: true });
});

// ── Events: remove lineup artist ──────────────────────────────────
app.delete('/api/events/:category/:slug/lineup/:index', (req, res) => {
  const { category, slug, index } = req.params;
  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });

  const details = readEventDetailsRaw(category, slug);
  if (!details) return res.status(404).json({ error: 'Event not found' });

  const i = Number(index);
  const lineup = details.lineup || [];
  if (i < 0 || i >= lineup.length) return res.status(400).json({ error: 'Invalid lineup index' });

  const [removed] = lineup.splice(i, 1);
  if (removed && removed.photo) {
    const photoPath = path.join(eventDir(category, slug), removed.photo);
    if (fs.existsSync(photoPath)) fs.unlinkSync(photoPath);
  }

  details.lineup = lineup;
  writeEventDetailsRaw(category, slug, details);
  writeManifest();
  res.json({ ok: true });
});

// ── Events: after movie ──────────────────────────────────────────
// Compresses to H.264 with the short side capped at 1080 (so 16:9 stays 1920×1080 and
// vertical 9:16 stays 1080×1920) and a bitrate cap (a 60s film lands around 30 MB),
// +faststart so it starts playing before it's fully downloaded. Grabs a still for the
// poster, and records the orientation so the page can show vertical films uncropped.
app.post('/api/events/:category/:slug/aftermovie', videoUpload.single('video'), async (req, res) => {
  const { category, slug } = req.params;
  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!req.file) return res.status(400).json({ error: 'Video file is required' });

  const dir = eventDir(category, slug);
  if (!fs.existsSync(dir)) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Event not found' });
  }

  const tmpVideo = path.join(dir, '_aftermovie-new.mp4');
  const tmpFrame = `${req.file.path}-frame.jpg`;
  try {
    await runFfmpeg([
      '-i', req.file.path,
      '-map', '0:v:0', '-map', '0:a:0?', // skip timecode/data tracks some cameras add
      '-vf', "scale=w='if(gte(iw\\,ih)\\,-2\\,min(1080\\,iw))':h='if(gte(iw\\,ih)\\,min(1080\\,ih)\\,-2)'",
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '23', '-maxrate', '4M', '-bufsize', '8M',
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-c:a', 'aac', '-b:a', '128k',
      tmpVideo,
    ]);

    if (fs.statSync(tmpVideo).size > MAX_VIDEO_BYTES) {
      throw new Error('compressed video is still over 95 MB — trim it under ~3 minutes');
    }

    await runFfmpeg(['-ss', '2', '-i', tmpVideo, '-frames:v', '1', '-q:v', '2', tmpFrame]);
    const { width, height } = await sharp(tmpFrame).metadata();
    await saveNormalizedImage({ path: tmpFrame, originalname: 'frame.jpg' }, path.join(dir, 'aftermovie-poster.jpg'), 1920);
    fs.renameSync(tmpVideo, path.join(dir, 'aftermovie.mp4'));

    const details = readEventDetailsRaw(category, slug);
    details.aftermovieOrientation = height > width ? 'portrait' : 'landscape';
    writeEventDetailsRaw(category, slug, details);
  } catch (err) {
    return res.status(400).json({ error: `Couldn't process that video (${err.message})` });
  } finally {
    for (const f of [req.file.path, tmpVideo, tmpFrame]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }

  writeManifest();
  res.json({ ok: true, size: fs.statSync(path.join(dir, 'aftermovie.mp4')).size });
});

app.delete('/api/events/:category/:slug/aftermovie', (req, res) => {
  const { category, slug } = req.params;
  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });

  const dir = eventDir(category, slug);
  for (const file of ['aftermovie.mp4', 'aftermovie-poster.jpg']) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  const details = readEventDetailsRaw(category, slug);
  if (details) {
    delete details.aftermovieOrientation;
    writeEventDetailsRaw(category, slug, details);
  }

  writeManifest();
  res.json({ ok: true });
});

// ── Events: gallery photos ───────────────────────────────────────
// Each photo is saved twice: 1600px for the lightbox, 600px for the grid.
// Files are numbered 001.jpg, 002.jpg… in upload order.
app.post('/api/events/:category/:slug/gallery', upload.array('photos', 60), async (req, res) => {
  const { category, slug } = req.params;
  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: 'Choose at least one photo' });

  const dir = eventDir(category, slug);
  if (!fs.existsSync(dir)) {
    files.forEach((f) => fs.unlinkSync(f.path));
    return res.status(404).json({ error: 'Event not found' });
  }

  const galleryDir = path.join(dir, 'gallery');
  const thumbsDir = path.join(galleryDir, 'thumbs');
  fs.mkdirSync(thumbsDir, { recursive: true });

  const existing = fs.readdirSync(galleryDir).filter((f) => /^\d+\.jpg$/.test(f)).map((f) => parseInt(f, 10));
  let next = existing.length ? Math.max(...existing) + 1 : 1;

  const failed = [];
  for (const file of files) {
    const filename = `${String(next).padStart(3, '0')}.jpg`;
    try {
      await saveNormalizedImage(file, path.join(galleryDir, filename), 1600);
      await sharp(path.join(galleryDir, filename)).resize({ width: 600 }).jpeg({ quality: 80 }).toFile(path.join(thumbsDir, filename));
      next += 1;
    } catch (err) {
      failed.push(file.originalname);
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
  }

  writeManifest();
  res.json({ ok: true, added: files.length - failed.length, failed });
});

app.delete('/api/events/:category/:slug/gallery/:file', (req, res) => {
  const { category, slug, file } = req.params;
  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!/^\d+\.jpg$/.test(file)) return res.status(400).json({ error: 'Invalid photo' });

  const galleryDir = path.join(eventDir(category, slug), 'gallery');
  for (const p of [path.join(galleryDir, file), path.join(galleryDir, 'thumbs', file)]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }

  writeManifest();
  res.json({ ok: true });
});

// ── Events: move between categories ───────────────────────────────
app.post('/api/events/:category/:slug/move', (req, res) => {
  const { category, slug } = req.params;
  const { toCategory } = req.body;
  if (!isValidCategory(category) || !isValidCategory(toCategory)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  if (category === toCategory) return res.json({ ok: true });

  const fromDir = eventDir(category, slug);
  if (!fs.existsSync(fromDir)) return res.status(404).json({ error: 'Event not found' });

  const toDir = eventDir(toCategory, uniqueSlug(toCategory, slug));
  fs.mkdirSync(categoryDir(toCategory), { recursive: true });
  fs.renameSync(fromDir, toDir);

  writeManifest();
  res.json({ ok: true });
});

// ── Events: delete ─────────────────────────────────────────────────
app.delete('/api/events/:category/:slug', (req, res) => {
  const { category, slug } = req.params;
  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });

  const dir = eventDir(category, slug);
  if (!fs.existsSync(dir)) return res.status(404).json({ error: 'Event not found' });

  fs.rmSync(dir, { recursive: true, force: true });
  writeManifest();
  res.json({ ok: true });
});

// ── Music: videos ──────────────────────────────────────────────────
app.get('/api/music/videos', (req, res) => {
  const file = path.join(MUSIC_DIR, 'videos.json');
  res.json(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);
});

app.put('/api/music/videos', (req, res) => {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  fs.writeFileSync(path.join(MUSIC_DIR, 'videos.json'), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// ── Music: soundcloud ───────────────────────────────────────────────
app.get('/api/music/soundcloud', (req, res) => {
  const file = path.join(MUSIC_DIR, 'soundcloud.json');
  res.json(fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {});
});

app.put('/api/music/soundcloud', (req, res) => {
  fs.mkdirSync(MUSIC_DIR, { recursive: true });
  fs.writeFileSync(path.join(MUSIC_DIR, 'soundcloud.json'), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// ── Error handling ─────────────────────────────────────────────────
// Catches multer errors (e.g. file too large) and anything else that
// throws, so the admin page always gets a clean JSON error instead of
// an HTML crash page it can't parse.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(400).json({ error: err.message || 'Something went wrong' });
});

// ── Start ────────────────────────────────────────────────────────────
writeManifest();
app.listen(PORT, () => {
  console.log('──────────────────────────────────────────');
  console.log(`Avec Anima dev server → http://localhost:${PORT}`);
  console.log(`Admin  → http://localhost:${PORT}/admin.html`);
  console.log('──────────────────────────────────────────');
});
