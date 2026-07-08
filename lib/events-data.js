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

function findPoster(dir) {
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir);
  const poster = files.find((f) =>
    POSTER_EXTENSIONS.includes(path.extname(f).toLowerCase()) && f.toLowerCase().startsWith('poster')
  );
  return poster || null;
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

    events.push({
      slug,
      poster: `assets/events/${category}/${slug}/${poster}`,
      ...details,
      lineup,
    });
  }

  return events;
}

function readAllEvents() {
  const upcoming = readCategory('upcoming').sort((a, b) => a.date.localeCompare(b.date));
  const previous = readCategory('previous').sort((a, b) => b.date.localeCompare(a.date));
  return { upcoming, previous };
}

function writeManifest() {
  const manifest = readAllEvents();
  fs.mkdirSync(EVENTS_ROOT, { recursive: true });
  fs.writeFileSync(path.join(EVENTS_ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));
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
