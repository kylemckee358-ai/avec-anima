// Event folders on disk + manifest writing (the folder rules themselves are in lib/event-rules.js).
// Used by build-events.js, process-uploads.js and server.js (auto-run after every admin edit).

const fs = require('fs');
const path = require('path');

const {
  CATEGORIES,
  AFTERMOVIE_FILE,
  AFTERMOVIE_POSTER_FILE,
  PHOTO_FILE,
  slugify,
  isPosterFile,
  orderPhotos,
  scanEvents,
} = require('./event-rules');

const EVENTS_ROOT = path.join(__dirname, '..', 'website', 'assets', 'events');

function categoryDir(category) {
  return path.join(EVENTS_ROOT, category);
}

function eventDir(category, slug) {
  return path.join(categoryDir(category), slug);
}

function listDir(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
}

// Newest by modified time — e.g. poster.jpg vs poster-<id>.jpg if two briefly coexist after a replace
function newestFile(dir, names) {
  return names
    .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)[0].f;
}

// The event folders on this disk, in the shape lib/event-rules.js expects
const diskStore = {
  listDirs: (rel) => listDir(path.join(EVENTS_ROOT, rel)).filter((f) => fs.statSync(path.join(EVENTS_ROOT, rel, f)).isDirectory()),
  listFiles: (rel) => listDir(path.join(EVENTS_ROOT, rel)).filter((f) => fs.statSync(path.join(EVENTS_ROOT, rel, f)).isFile()),
  readJson: (rel) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(EVENTS_ROOT, rel), 'utf8'));
    } catch (err) {
      return null;
    }
  },
  newest: (rel, names) => newestFile(path.join(EVENTS_ROOT, rel), names),
};

function findPoster(dir) {
  const posters = listDir(dir).filter(isPosterFile);
  return posters.length ? newestFile(dir, posters) : null;
}

function galleryOrderPath(galleryDir) {
  return path.join(galleryDir, 'order.json');
}

function readGalleryOrder(galleryDir) {
  let saved = [];
  try {
    saved = JSON.parse(fs.readFileSync(galleryOrderPath(galleryDir), 'utf8'));
  } catch (err) {
    // no order saved yet
  }
  return orderPhotos(listDir(galleryDir), saved);
}

function writeGalleryOrder(galleryDir, files) {
  fs.mkdirSync(galleryDir, { recursive: true });
  fs.writeFileSync(galleryOrderPath(galleryDir), JSON.stringify(files, null, 2));
}

// includeIncomplete: also list events whose poster hasn't arrived yet (admin only)
function readAllEvents(options) {
  return scanEvents(diskStore, options);
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
