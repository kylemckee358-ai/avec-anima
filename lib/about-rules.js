// About page rules with no file access — shared by lib/about.js (local admin + build)
// and the online admin (worker/), which reads and writes about.json through GitHub instead.
//
// website/assets/about/about.json, edited from the admin "About" tab:
//   {
//     "intro": "Paragraphs, with a blank line between them",
//     "founders": { "name": "Yeardos", "members": "Ammon & Ben Yeardsley", "role": "Founders & Directors",
//                   "genre": "…", "bio": "…", "photo": "yeardos-<id>.jpg" },
//     "guestsIntro": "Line above the Guest DJs (built automatically from event lineups by lib/seo.js)",
//     "guests": [{ "name": "Fionn", "genre": "…", "from": "…", "bio": "…", "photo": "fionn-<id>.jpg" }]  (optional details,
//                matched to lineup names; shown in the tile that opens when a guest is clicked)
//     "artists": [{ "name": "Burg", "role": "Resident", "genre": "…", "from": "…", "bio": "…", "photo": "burg-<id>.jpg" }]
//   }
// Each photo is a file in website/assets/about/, written by a 'resident-photo' upload (or null).
// Anyone with a photo can also have "crop": { "x": 50, "y": 30, "zoom": 1.6 } — set with the admin's
// Adjust button: the point to keep in frame (percent across/down the photo) and how far to zoom in.
// The photo itself is never changed; the site applies the crop when showing it (photoCropStyle).
// Uploads find their person by name, so names are unique across founders + artists.

const ABOUT_PHOTO_FILE = /^[a-z0-9-]+\.jpg$/;

const DEFAULTS = {
  intro:
    'Avec Anima is an underground house and tech house night on the Isle of Man, running events at venues ' +
    'across the island — from Douglas clubs to one-off nights in the glens. No two are the same.\n\n' +
    'It all starts with the music: selectors who dig deep, a properly tuned sound and a crowd that comes to dance. ' +
    'The posters, the films and the photos all come from the same place — so every night feels like Anima ' +
    'from the first announcement to the last record.',
  founders: { name: '', members: '', role: '', genre: '', bio: '', photo: null },
  artists: [],
  guestsIntro:
    "Not everyone plays every night. These are the DJs who've stepped up as guests at Anima — " +
    'some for one night, some a few times over.',
  guests: [],
};

const FOUNDER_FIELDS = ['name', 'members', 'role', 'genre', 'bio'];
const ARTIST_FIELDS = ['name', 'role', 'genre', 'from', 'bio'];
const GUEST_FIELDS = ['name', 'genre', 'from', 'bio'];

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(Math.min(max, Math.max(min, n)) * 10) / 10 : fallback;
}

// null means "as uploaded" (the site's default framing)
function cleanCrop(crop) {
  if (!crop || typeof crop !== 'object') return null;
  const clean = { x: clampNumber(crop.x, 0, 100, 50), y: clampNumber(crop.y, 0, 100, 30), zoom: clampNumber(crop.zoom, 1, 3, 1) };
  return clean.x === 50 && clean.y === 30 && clean.zoom === 1 ? null : clean;
}

function cleanPerson(raw, fields, keepPhoto) {
  const person = {};
  for (const field of fields) person[field] = String((raw && raw[field]) || '').trim();
  person.photo = keepPhoto(raw && raw.photo) ? raw.photo : null;
  person.crop = person.photo ? cleanCrop(raw && raw.crop) : null;
  return person;
}

const validPhoto = (photo) => ABOUT_PHOTO_FILE.test(photo || '');

// Saved content with defaults filled in for anything missing
function mergeAbout(saved) {
  const about = { ...DEFAULTS, ...(saved || {}) };
  return {
    intro: String(about.intro || ''),
    founders: cleanPerson(about.founders, FOUNDER_FIELDS, validPhoto),
    artists: (Array.isArray(about.artists) ? about.artists : []).map((a) => cleanPerson(a, ARTIST_FIELDS, validPhoto)),
    guestsIntro: String(about.guestsIntro || ''),
    guests: (Array.isArray(about.guests) ? about.guests : []).map((g) => cleanPerson(g, GUEST_FIELDS, validPhoto)),
  };
}

// Founders (if named), resident artists and guest details — everyone a headshot can belong to
function people(about) {
  return [...(about.founders.name ? [about.founders] : []), ...about.artists, ...about.guests];
}

// The founders, artist or guest entry with this exact name, for photo uploads
function findPerson(about, name) {
  return people(about).find((p) => p.name === name) || null;
}

// Applies the admin form (intro, founders, the full artist list in order, guest details) to the saved content.
// Photos can't be set here — only kept, if they already belong to someone — so
// returns the photos no longer used, for the caller to delete.
function applyAboutUpdate(current, update) {
  if (!update || !Array.isArray(update.artists)) throw new Error('Expected a list of artists');

  const knownPhotos = new Set(people(current).map((p) => p.photo).filter(Boolean));
  const keepPhoto = (photo) => knownPhotos.has(photo);
  const about = {
    intro: update.intro === undefined ? current.intro : String(update.intro || '').trim(),
    founders: update.founders === undefined ? current.founders : cleanPerson(update.founders, FOUNDER_FIELDS, keepPhoto),
    artists: update.artists.map((a) => cleanPerson(a, ARTIST_FIELDS, keepPhoto)).filter((a) => a.name),
    guestsIntro: update.guestsIntro === undefined ? current.guestsIntro : String(update.guestsIntro || '').trim(),
    guests: (Array.isArray(update.guests) ? update.guests : current.guests)
      .map((g) => cleanPerson(g, GUEST_FIELDS, keepPhoto))
      .filter((g) => g.name),
  };

  // A guest who's become a founder or resident drops out of the guests — bringing their photo along
  const promoted = new Map();
  for (const p of [about.founders, ...about.artists]) if (p.name) promoted.set(p.name.toLowerCase(), p);
  about.guests = about.guests.filter((g) => {
    const now = promoted.get(g.name.toLowerCase());
    if (!now) return true;
    if (!now.photo && g.photo) {
      now.photo = g.photo;
      now.crop = g.crop;
    }
    return false;
  });

  const everyone = people(about);
  const names = everyone.map((p) => p.name.toLowerCase());
  const repeated = names.findIndex((name, i) => names.indexOf(name) !== i);
  if (repeated !== -1) throw new Error(`Two entries are called "${everyone[repeated].name}" — give each a different name`);

  const kept = new Set(everyone.map((p) => p.photo).filter(Boolean));
  return { about, removedPhotos: [...knownPhotos].filter((p) => !kept.has(p)) };
}

module.exports = { ABOUT_PHOTO_FILE, DEFAULTS, mergeAbout, findPerson, applyAboutUpdate };
