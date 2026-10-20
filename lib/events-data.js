// Shared event-folder scanning + manifest writing.
// Used by both build-events.js (manual one-off run) and server.js (auto-run after every admin edit).

const fs = require('fs');
const path = require('path');

const EVENTS_ROOT = path.join(__dirname, '..', 'website', 'assets', 'events');
const POSTER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const CATEGORIES = ['upcoming', 'previous'];

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function categoryDir(category) {
  return path.join(EVENTS_ROOT, category);
}

function eventDir(category, slug) {
  return path.join(categoryDir(category), slug);
}

// poster.jpg, or poster-<id>.jpg after a replace — newest wins if two briefly coexist
function findPoster(dir) {
  if (!fs.existsSync(dir)) return null;
  const posters = fs.readdirSync(dir).filter((f) =>
    POSTER_EXTENSIONS.includes(path.extname(f).toLowerCase()) && f.toLowerCase().startsWith('poster')
  );
  if (!posters.length) return null;
  return posters
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0].f;
}

// Gallery media lives inside the event folder (written by the admin upload endpoints):
//   aftermovie[-id].mp4, aftermovie-poster[-id].jpg, gallery/<id>.jpg, gallery/thumbs/<id>.jpg,
//   gallery/order.json (photo display order).
// Files are never renamed after they're written — the project lives in an iCloud-synced
// folder, and iCloud turns quick renames into "name 2.jpg" conflict copies. New uploads get
// new unique names instead, and order is stored separately.
const AFTERMOVIE_FILE = /^aftermovie(-[a-z0-9]+)?\.mp4$/;
const AFTERMOVIE_POSTER_FILE = /^aftermovie-poster(-[a-z0-9]+)?\.jpg$/;
const PHOTO_FILE = /^[a-z0-9-]+\.jpg$/;

function newestMatch(dir, pattern) {
  if (!fs.existsSync(dir)) return null;
  const matches = fs.readdirSync(dir).filter((f) => pattern.test(f));
  if (!matches.length) return null;
  return matches
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0].f;
}

function galleryOrderPath(galleryDir) {
  return path.join(galleryDir, 'order.json');
}

// Photos in display order: those listed in order.json first, then any others by name
function readGalleryOrder(galleryDir) {
  if (!fs.existsSync(galleryDir)) return [];
  const files = fs.readdirSync(galleryDir).filter((f) => PHOTO_FILE.test(f));
  let saved = [];
  try {
    saved = JSON.parse(fs.readFileSync(galleryOrderPath(galleryDir), 'utf8'));
  } catch (err) {
    // no order saved yet
  }
  const present = new Set(files);
  const ordered = saved.filter((f) => present.has(f));
  const listed = new Set(ordered);
  return [...ordered, ...files.filter((f) => !listed.has(f)).sort()];
}

function writeGalleryOrder(galleryDir, files) {
  fs.mkdirSync(galleryDir, { recursive: true });
  fs.writeFileSync(galleryOrderPath(galleryDir), JSON.stringify(files, null, 2));
}

function readGalleryMedia(dir) {
  return {
    aftermovie: newestMatch(dir, AFTERMOVIE_FILE),
    aftermoviePoster: newestMatch(dir, AFTERMOVIE_POSTER_FILE),
    photos: readGalleryOrder(path.join(dir, 'gallery')),
  };
}

function readCategory(category) {
  const dir = categoryDir(category);
  if (!fs.existsSync(dir)) return [];

  const slugs = fs.readdirSync(dir).filter((entry) => fs.statSync(path.join(dir, entry)).isDirectory());

  const events = [];
  for (const slug of slugs) {
    const dEventDir = path.join(dir, slug);
    const detailsPath = path.join(dEventDir, 'event-details.json');
    if (!fs.existsSync(detailsPath)) {
      console.warn(`Skipping "${category}/${slug}" — no event-details.json found`);
      continue;
    }

    const details = JSON.parse(fs.readFileSync(detailsPath, 'utf8'));
    const poster = findPoster(dEventDir);
    if (!poster) {
      console.warn(`Skipping "${category}/${slug}" — no poster image found`);
      continue;
    }

    const lineup = (details.lineup || []).map((artist) => ({
      ...artist,
      photo: artist.photo ? `assets/events/${category}/${slug}/${artist.photo}` : null,
    }));

    const base = `assets/events/${category}/${slug}`;
    const media = readGalleryMedia(dEventDir);

    events.push({
      slug,
      poster: `${base}/${poster}`,
      ...details,
      lineup,
      aftermovie: media.aftermovie ? `${base}/${media.aftermovie}` : null,
      aftermoviePoster: media.aftermoviePoster ? `${base}/${media.aftermoviePoster}` : null,
      gallery: media.photos.map((file) => ({
        src: `${base}/gallery/${file}`,
        thumb: `${base}/gallery/thumbs/${file}`,
      })),
    });
  }

  return events;
}

function readAllEvents() {
  const upcoming = readCategory('upcoming').sort((a, b) => a.date.localeCompare(b.date));
  const previous = readCategory('previous').sort((a, b) => b.date.localeCompare(a.date));

  // Each event gets a static page at events/<slug>.html (built by lib/seo.js).
  // Slugs are only unique per category, so prefix the rare cross-category clash.
  const upcomingSlugs = new Set(upcoming.map((e) => e.slug));
  upcoming.forEach((e) => { e.page = `events/${e.slug}.html`; });
  previous.forEach((e) => {
    e.page = upcomingSlugs.has(e.slug) ? `events/previous-${e.slug}.html` : `events/${e.slug}.html`;
  });

  return { upcoming, previous };
}

function writeManifest() {
  const manifest = readAllEvents();
  fs.mkdirSync(EVENTS_ROOT, { recursive: true });
  fs.writeFileSync(path.join(EVENTS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  // Required lazily — seo.js requires this module too
  require('./seo').writeSeoFiles(manifest);
  return manifest;
}

// Reads event-details.json directly from disk (unresolved photo paths) — for admin editing.
function readEventDetailsRaw(category, slug) {
  const detailsPath = path.join(eventDir(category, slug), 'event-details.json');
  if (!fs.existsSync(detailsPath)) return null;
  return JSON.parse(fs.readFileSync(detailsPath, 'utf8'));
}

function writeEventDetailsRaw(category, slug, details) {
  const dir = eventDir(category, slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'event-details.json'), JSON.stringify(details, null, 2));
}

module.exports = {
  EVENTS_ROOT,
  AFTERMOVIE_FILE,
  AFTERMOVIE_POSTER_FILE,
  PHOTO_FILE,
  readGalleryOrder,
  writeGalleryOrder,
  CATEGORIES,
  slugify,
  categoryDir,
  eventDir,
  findPoster,
  readAllEvents,
  writeManifest,
  readEventDetailsRaw,
  writeEventDetailsRaw,
};
