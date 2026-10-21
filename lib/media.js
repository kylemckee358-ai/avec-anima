// Image + video processing shared by server.js (admin uploads on this Mac) and
// process-uploads.js (uploads from the online admin, processed in the GitHub build).
// Every function takes a "file" shaped like multer's: { path, originalname, mimetype }.
// The input file at file.path is consumed (deleted) once it's been processed.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const heicConvert = require('heic-convert');
const { execFile } = require('child_process');

const {
  slugify,
  eventDir,
  findPoster,
  readEventDetailsRaw,
  writeEventDetailsRaw,
  AFTERMOVIE_FILE,
  AFTERMOVIE_POSTER_FILE,
  readGalleryOrder,
  writeGalleryOrder,
} = require('./events-data');

// Fresh short id for new filenames. Files are never renamed onto a name that was just
// in use — this folder syncs to iCloud, which turns that into "name 2.jpg" conflict copies.
function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function removeMatching(dir, pattern, keep) {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (pattern.test(f) && f !== keep) fs.unlinkSync(path.join(dir, f));
  }
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

// Homebrew's ffmpeg isn't on PATH when node is started from some apps, so look in the usual spots
const FFMPEG = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg'].find((p) => fs.existsSync(p)) || 'ffmpeg';
const FFPROBE = FFMPEG.replace(/ffmpeg$/, 'ffprobe');
const MAX_VIDEO_BYTES = 95 * 1024 * 1024; // GitHub rejects files over 100 MB

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    execFile(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', ...args], { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr.trim().split('\n').pop() || err.message));
      else resolve();
    });
  });
}

function videoDuration(file) {
  return new Promise((resolve) => {
    execFile(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], (err, stdout) => {
      resolve(err ? 0 : parseFloat(stdout) || 0);
    });
  });
}

// ── Poster ───────────────────────────────────────────────────────────
// Saved under a new name, then the old one is removed.
async function replacePoster(category, slug, file) {
  const dir = eventDir(category, slug);
  const oldPoster = findPoster(dir);
  await saveNormalizedImage(file, path.join(dir, `poster-${newId()}.jpg`));
  if (oldPoster) fs.unlinkSync(path.join(dir, oldPoster));
}

// ── Gallery photos ───────────────────────────────────────────────────
// Each photo is saved twice: 1600px for the lightbox, 600px for the grid, under a new
// unique name, and appended to gallery/order.json.
async function addGalleryPhotos(category, slug, files) {
  const galleryDir = path.join(eventDir(category, slug), 'gallery');
  const thumbsDir = path.join(galleryDir, 'thumbs');
  fs.mkdirSync(thumbsDir, { recursive: true });

  const order = readGalleryOrder(galleryDir);
  const failed = [];
  for (const file of files) {
    const filename = `${newId()}.jpg`;
    try {
      await saveNormalizedImage(file, path.join(galleryDir, filename), 1600);
      await sharp(path.join(galleryDir, filename)).resize({ width: 600 }).jpeg({ quality: 80 }).toFile(path.join(thumbsDir, filename));
      order.push(filename);
    } catch (err) {
      failed.push(file.originalname);
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
  }

  writeGalleryOrder(galleryDir, order);
  return { added: files.length - failed.length, failed };
}

// ── Lineup headshots ─────────────────────────────────────────────────
// Unique name per upload so browsers don't show the old cached headshot.
async function replaceArtistPhoto(category, slug, index, file) {
  const details = readEventDetailsRaw(category, slug);
  const artist = details && (details.lineup || [])[index];
  if (!artist) throw new Error('Artist not found');

  const lineupDir = path.join(eventDir(category, slug), 'lineup');
  fs.mkdirSync(lineupDir, { recursive: true });
  const filename = `${slugify(artist.name) || 'artist'}-${Date.now().toString(36)}.jpg`;
  await saveNormalizedImage(file, path.join(lineupDir, filename));

  if (artist.photo) {
    const old = path.join(eventDir(category, slug), artist.photo);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }
  artist.photo = `lineup/${filename}`;
  writeEventDetailsRaw(category, slug, details);
}

// ── After movie ──────────────────────────────────────────────────────
// Compresses to H.264 with the short side capped at 1080 (so 16:9 stays 1920×1080 and
// vertical 9:16 stays 1080×1920) and a bitrate cap (a 60s film lands around 30 MB),
// +faststart so it starts playing before it's fully downloaded. Grabs a still for the
// poster, and records the orientation so the page can show vertical films uncropped.
// Returns the compressed size in bytes.
async function processAftermovie(category, slug, file) {
  const dir = eventDir(category, slug);

  // Encode next to the upload, then move in under a brand-new name and delete the old film
  const id = newId();
  const videoName = `aftermovie-${id}.mp4`;
  const posterName = `aftermovie-poster-${id}.jpg`;
  const tmpVideo = `${file.path}-encoded.mp4`;
  const tmpFrame = `${file.path}-frame.jpg`;
  try {
    await runFfmpeg([
      '-i', file.path,
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

    // Preview still from 20% in — the first seconds are often a title card or a fade from black
    const still = Math.max(2, (await videoDuration(tmpVideo)) * 0.2).toFixed(2);
    await runFfmpeg(['-ss', still, '-i', tmpVideo, '-frames:v', '1', '-q:v', '2', tmpFrame]);
    const { width, height } = await sharp(tmpFrame).metadata();
    await saveNormalizedImage({ path: tmpFrame, originalname: 'frame.jpg' }, path.join(dir, posterName), 1920);
    fs.copyFileSync(tmpVideo, path.join(dir, videoName));
    removeMatching(dir, AFTERMOVIE_FILE, videoName);
    removeMatching(dir, AFTERMOVIE_POSTER_FILE, posterName);

    const details = readEventDetailsRaw(category, slug);
    details.aftermovieOrientation = height > width ? 'portrait' : 'landscape';
    writeEventDetailsRaw(category, slug, details);
  } finally {
    for (const f of [file.path, tmpVideo, tmpFrame]) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }

  return fs.statSync(path.join(dir, videoName)).size;
}

module.exports = {
  newId,
  removeMatching,
  saveNormalizedImage,
  replacePoster,
  addGalleryPhotos,
  replaceArtistPhoto,
  processAftermovie,
};
