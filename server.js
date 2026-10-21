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
 * The same admin page also runs online (worker/), where uploads are processed by the
 * GitHub build instead — so uploads go through one shared set of steps (lib/upload-rules.js).
 *
 * API:
 *   GET    /api/info                            — { mode: 'local' } (online: 'online')
 *   GET    /api/events                          — list all events (upcoming + previous), incl. ones still missing a poster
 *   GET    /api/events/:category/:slug          — single event, raw fields
 *   POST   /api/events                          — create event (json: fields + lineup: ['name', ...]); poster follows as an upload
 *   PUT    /api/events/:category/:slug          — edit core fields (json body)
 *   POST   /api/events/:category/:slug/lineup   — add lineup artist (json: { name }) → { index }; headshot follows as an upload
 *   DELETE /api/events/:category/:slug/lineup/:index — remove lineup artist by index
 *   POST   /api/events/:category/:slug/move     — move upcoming <-> previous (json: { toCategory })
 *   DELETE /api/events/:category/:slug          — delete event entirely
 *   DELETE /api/events/:category/:slug/aftermovie — remove after movie
 *   DELETE /api/events/:category/:slug/gallery/:file — remove one gallery photo
 *   PUT    /api/events/:category/:slug/gallery/order — reorder photos (json: { files: ['<id>.jpg', ...] })
 *   POST   /api/events/:category/:slug/gallery/delete — remove several photos (json: { files: [...] })
 *   PUT    /api/events/:category/:slug/lineup       — rename/reorder lineup (json: [{ name, photo }])
 *   POST   /api/uploads (+ PUT file, POST finish, GET status) — posters, headshots, photos, films (see lib/upload-rules.js)
 *   GET    /api/site                            — site settings (links, page text, Google titles)
 *   PUT    /api/site                            — save site settings (json), rebuilds every page
 *   GET    /api/music/videos                    — read videos.json
 *   PUT    /api/music/videos                    — overwrite videos.json (json array)
 *   GET    /api/music/soundcloud                — read soundcloud.json
 *   PUT    /api/music/soundcloud                 — overwrite soundcloud.json (json object)
 */

const express = require('express');
const path = require('path');
const fs = require('fs');

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
  AFTERMOVIE_FILE,
  AFTERMOVIE_POSTER_FILE,
  PHOTO_FILE,
  readGalleryOrder,
  writeGalleryOrder,
} = require('./lib/events-data');

const { removeMatching } = require('./lib/media');
const { CHUNK_SIZE, newJobId, planJob } = require('./lib/upload-rules');
const { runJob } = require('./process-uploads');
const { readSite, writeSite } = require('./lib/site');

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

// ── Events: read ──────────────────────────────────────────────────
app.get('/api/info', (req, res) => {
  res.json({ mode: 'local' });
});

app.get('/api/events', (req, res) => {
  res.json(readAllEvents({ includeIncomplete: true }));
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
// Lineup arrives as a list of names; the admin then uploads the poster and any
// headshots through /api/uploads (the event isn't on the public site until its poster is in).
app.post('/api/events', (req, res) => {
  const { category, name, date, startTime, endTime, location, ticketLink, description } = req.body;

  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!name || !date) return res.status(400).json({ error: 'Name and date are required' });

  const slug = uniqueSlug(category, slugify(name));
  const lineup = (Array.isArray(req.body.lineup) ? req.body.lineup : [])
    .map((artistName) => String(artistName || '').trim())
    .filter(Boolean)
    .map((artistName) => ({ name: artistName, photo: null }));

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

  // No manifest rebuild yet — the event can't be shown until its poster upload is processed
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

// ── Events: add lineup artist ─────────────────────────────────────
app.post('/api/events/:category/:slug/lineup', (req, res) => {
  const { category, slug } = req.params;
  const name = String(req.body.name || '').trim();
  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!name) return res.status(400).json({ error: 'Artist name is required' });

  const details = readEventDetailsRaw(category, slug);
  if (!details) return res.status(404).json({ error: 'Event not found' });

  details.lineup = [...(details.lineup || []), { name, photo: null }];
  writeEventDetailsRaw(category, slug, details);
  writeManifest();
  res.json({ ok: true, index: details.lineup.length - 1 });
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
app.delete('/api/events/:category/:slug/aftermovie', (req, res) => {
  const { category, slug } = req.params;
  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });

  const dir = eventDir(category, slug);
  removeMatching(dir, AFTERMOVIE_FILE);
  removeMatching(dir, AFTERMOVIE_POSTER_FILE);

  const details = readEventDetailsRaw(category, slug);
  if (details) {
    delete details.aftermovieOrientation;
    writeEventDetailsRaw(category, slug, details);
  }

  writeManifest();
  res.json({ ok: true });
});

// ── Events: gallery photos ───────────────────────────────────────
app.delete('/api/events/:category/:slug/gallery/:file', (req, res) => {
  const { category, slug, file } = req.params;
  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });
  if (!PHOTO_FILE.test(file)) return res.status(400).json({ error: 'Invalid photo' });

  removeGalleryPhotos(path.join(eventDir(category, slug), 'gallery'), [file]);

  writeManifest();
  res.json({ ok: true });
});

function removeGalleryPhotos(galleryDir, files) {
  for (const file of files) {
    for (const p of [path.join(galleryDir, file), path.join(galleryDir, 'thumbs', file)]) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }
  if (fs.existsSync(galleryDir)) {
    const removed = new Set(files);
    writeGalleryOrder(galleryDir, readGalleryOrder(galleryDir).filter((f) => !removed.has(f)));
  }
}

app.put('/api/events/:category/:slug/gallery/order', (req, res) => {
  const { category, slug } = req.params;
  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });

  const galleryDir = path.join(eventDir(category, slug), 'gallery');
  const existing = readGalleryOrder(galleryDir);
  const order = Array.isArray(req.body.files) ? req.body.files : [];

  // Must be exactly the current set of photos, just reordered
  if (order.length !== existing.length || [...order].sort().join() !== [...existing].sort().join()) {
    return res.status(400).json({ error: 'Photo list is out of date — refresh and try again' });
  }

  writeGalleryOrder(galleryDir, order);
  writeManifest();
  res.json({ ok: true });
});

app.post('/api/events/:category/:slug/gallery/delete', (req, res) => {
  const { category, slug } = req.params;
  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });

  const files = (Array.isArray(req.body.files) ? req.body.files : []).filter((f) => PHOTO_FILE.test(f));
  const galleryDir = path.join(eventDir(category, slug), 'gallery');
  removeGalleryPhotos(galleryDir, files);

  writeManifest();
  res.json({ ok: true, removed: files.length });
});

// ── Events: lineup edit/reorder + headshot replace ───────────────
app.put('/api/events/:category/:slug/lineup', (req, res) => {
  const { category, slug } = req.params;
  if (!isValidCategory(category)) return res.status(400).json({ error: 'Invalid category' });

  const details = readEventDetailsRaw(category, slug);
  if (!details) return res.status(404).json({ error: 'Event not found' });
  if (!Array.isArray(req.body)) return res.status(400).json({ error: 'Expected a list of artists' });

  // Only keep photo paths that already belong to this event's lineup
  const knownPhotos = new Set((details.lineup || []).map((a) => a.photo).filter(Boolean));
  const lineup = req.body
    .map((a) => ({ name: String(a.name || '').trim(), photo: knownPhotos.has(a.photo) ? a.photo : null }))
    .filter((a) => a.name);

  // Delete headshots for artists that were removed
  const kept = new Set(lineup.map((a) => a.photo).filter(Boolean));
  for (const photo of knownPhotos) {
    if (!kept.has(photo)) {
      const p = path.join(eventDir(category, slug), photo);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  }

  details.lineup = lineup;
  writeEventDetailsRaw(category, slug, details);
  writeManifest();
  res.json({ ok: true });
});

// ── Uploads: posters, headshots, photos, films (steps in lib/upload-rules.js) ──
// Files collect in .uploads/jobs/<id>/; finishing runs the job straight away with the
// same code the GitHub build uses for uploads from the online admin.
const UPLOADS_DIR = path.join(ROOT, '.uploads', 'jobs');
const uploadResults = new Map();

function uploadDir(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Invalid upload');
  return path.join(UPLOADS_DIR, id);
}

function readPlan(id) {
  const file = path.join(uploadDir(id), 'plan.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

app.post('/api/uploads', (req, res) => {
  let plan;
  try {
    plan = planJob(req.body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (!fs.existsSync(eventDir(plan.job.category, plan.job.slug))) return res.status(404).json({ error: 'Event not found' });

  const id = newJobId();
  fs.mkdirSync(uploadDir(id), { recursive: true });
  fs.writeFileSync(path.join(uploadDir(id), 'plan.json'), JSON.stringify(plan));
  res.json({ id, files: plan.files, chunkSize: CHUNK_SIZE });
});

app.put('/api/uploads/:id/:file', express.raw({ type: () => true, limit: CHUNK_SIZE + 1024 * 1024 }), (req, res) => {
  const { id, file } = req.params;
  const plan = readPlan(id);
  if (!plan || !plan.files.includes(file)) return res.status(404).json({ error: 'Upload not found' });

  const part = Number(req.query.part) || 1;
  const target = path.join(uploadDir(id), file);
  if (part === 1) fs.writeFileSync(target, req.body);
  else fs.appendFileSync(target, req.body); // parts arrive in order
  res.json({ ok: true, uploadId: 'local', etag: String(part) });
});

app.post('/api/uploads/:id/:file/complete', (req, res) => {
  res.json({ ok: true });
});

app.post('/api/uploads/:id/finish', async (req, res) => {
  const { id } = req.params;
  const plan = readPlan(id);
  if (!plan) return res.status(404).json({ error: 'Upload not found' });

  let result;
  try {
    result = { status: 'done', message: await runJob(uploadDir(id), plan.job) };
    writeManifest();
  } catch (err) {
    result = { status: 'failed', message: err.message };
  }
  fs.rmSync(uploadDir(id), { recursive: true, force: true });
  uploadResults.set(id, result);
  res.json(result);
});

app.get('/api/uploads/:id', (req, res) => {
  res.json(uploadResults.get(req.params.id) || { status: 'failed', message: 'Upload not found' });
});

// ── Site settings ────────────────────────────────────────────────
app.get('/api/site', (req, res) => {
  res.json(readSite());
});

app.put('/api/site', (req, res) => {
  const site = writeSite(req.body || {});
  writeManifest(); // rebuilds every page with the new links/text
  res.json({ ok: true, site });
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
  writeManifest(); // Music page banner uses the video thumbnails
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
// Catches upload errors (e.g. a chunk too large) and anything else that
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
