// Event folder rules with no file access — shared by lib/events-data.js (local admin + build)
// and the online admin (worker/), which reads the same folders through GitHub instead.
//
// scanEvents() takes a "store" that answers questions about the events folder
// (paths relative to website/assets/events):
//   listDirs(rel)  → sub-folder names        listFiles(rel) → file names
//   readJson(rel)  → parsed JSON or null     newest(rel, names) → the newest of those files

const POSTER_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const CATEGORIES = ['upcoming', 'previous'];

// Gallery media lives inside the event folder (written by the admin upload endpoints):
//   aftermovie[-id].mp4, aftermovie-poster[-id].jpg, gallery/<id>.jpg, gallery/thumbs/<id>.jpg,
//   gallery/order.json (photo display order).
// Files are never renamed after they're written — the project lives in an iCloud-synced
// folder, and iCloud turns quick renames into "name 2.jpg" conflict copies. New uploads get
// new unique names instead, and order is stored separately.
const AFTERMOVIE_FILE = /^aftermovie(-[a-z0-9]+)?\.mp4$/;
const AFTERMOVIE_POSTER_FILE = /^aftermovie-poster(-[a-z0-9]+)?\.jpg$/;
const PHOTO_FILE = /^[a-z0-9-]+\.jpg$/;

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function isPosterFile(name) {
  const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
  return POSTER_EXTENSIONS.includes(ext) && name.toLowerCase().startsWith('poster');
}

// Photos in display order: those listed in order.json first, then any others by name
function orderPhotos(files, saved) {
  const photos = files.filter((f) => PHOTO_FILE.test(f));
  const present = new Set(photos);
  const ordered = (Array.isArray(saved) ? saved : []).filter((f) => present.has(f));
  const listed = new Set(ordered);
  return [...ordered, ...photos.filter((f) => !listed.has(f)).sort()];
}

// One event as the site and admin see it. Returns null (with a reason) when it can't be shown.
// includeIncomplete keeps events whose poster hasn't been processed yet (online admin).
function readEvent(store, category, slug, { includeIncomplete = false } = {}) {
  const rel = `${category}/${slug}`;
  const details = store.readJson(`${rel}/event-details.json`);
  if (!details) return { skip: 'no event-details.json found' };

  const files = store.listFiles(rel);
  const posters = files.filter(isPosterFile);
  const poster = posters.length ? store.newest(rel, posters) : null;
  if (!poster && !includeIncomplete) return { skip: 'no poster image found' };

  const base = `assets/events/${rel}`;
  const lineup = (details.lineup || []).map((artist) => ({
    ...artist,
    photo: artist.photo ? `${base}/${artist.photo}` : null,
  }));

  const films = files.filter((f) => AFTERMOVIE_FILE.test(f));
  const stills = files.filter((f) => AFTERMOVIE_POSTER_FILE.test(f));
  const aftermovie = films.length ? store.newest(rel, films) : null;
  const aftermoviePoster = stills.length ? store.newest(rel, stills) : null;
  const photos = orderPhotos(store.listFiles(`${rel}/gallery`), store.readJson(`${rel}/gallery/order.json`));

  return {
    event: {
      slug,
      poster: poster ? `${base}/${poster}` : null,
      ...details,
      lineup,
      aftermovie: aftermovie ? `${base}/${aftermovie}` : null,
      aftermoviePoster: aftermoviePoster ? `${base}/${aftermoviePoster}` : null,
      gallery: photos.map((file) => ({
        src: `${base}/gallery/${file}`,
        thumb: `${base}/gallery/thumbs/${file}`,
      })),
    },
  };
}

function scanEvents(store, options = {}) {
  const byCategory = {};
  for (const category of CATEGORIES) {
    byCategory[category] = [];
    for (const slug of store.listDirs(category)) {
      const { event, skip } = readEvent(store, category, slug, options);
      if (event) byCategory[category].push(event);
      else console.warn(`Skipping "${category}/${slug}" — ${skip}`);
    }
  }

  const upcoming = byCategory.upcoming.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const previous = byCategory.previous.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  // Each event gets a static page at events/<slug>.html (built by lib/seo.js).
  // Slugs are only unique per category, so prefix the rare cross-category clash.
  const upcomingSlugs = new Set(upcoming.map((e) => e.slug));
  upcoming.forEach((e) => { e.page = `events/${e.slug}.html`; });
  previous.forEach((e) => {
    e.page = upcomingSlugs.has(e.slug) ? `events/previous-${e.slug}.html` : `events/${e.slug}.html`;
  });

  return { upcoming, previous };
}

module.exports = {
  CATEGORIES,
  AFTERMOVIE_FILE,
  AFTERMOVIE_POSTER_FILE,
  PHOTO_FILE,
  slugify,
  isPosterFile,
  orderPhotos,
  scanEvents,
};
