// About page rules with no file access — shared by lib/about.js (local admin + build)
// and the online admin (worker/), which reads and writes about.json through GitHub instead.
//
// website/assets/about/about.json, edited from the admin "About" tab:
//   {
//     "intro": "Paragraphs, with a blank line between them",
//     "founders": { "name": "Yeardos", "members": "Ammon & Ben Yeardsley", "role": "Founders & Directors",
//                   "genre": "…", "bio": "…", "photo": "yeardos-<id>.jpg" },
//     "artists": [{ "name": "Burg", "role": "Resident", "genre": "…", "from": "…", "bio": "…", "photo": "burg-<id>.jpg" }]
//   }
// Each photo is a file in website/assets/about/, written by a 'resident-photo' upload (or null).
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
};

const FOUNDER_FIELDS = ['name', 'members', 'role', 'genre', 'bio'];
const ARTIST_FIELDS = ['name', 'role', 'genre', 'from', 'bio'];

function cleanPerson(raw, fields, keepPhoto) {
  const person = {};
  for (const field of fields) person[field] = String((raw && raw[field]) || '').trim();
  person.photo = keepPhoto(raw && raw.photo) ? raw.photo : null;
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
  };
}

// Founders (if named) + resident artists — everyone a headshot can belong to
function people(about) {
  return [...(about.founders.name ? [about.founders] : []), ...about.artists];
}

// The founders or artist entry with this exact name, for photo uploads
function findPerson(about, name) {
  return people(about).find((p) => p.name === name) || null;
}

// Applies the admin form (intro, founders, the full artist list in order) to the saved content.
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
  };

  const everyone = people(about);
  const names = everyone.map((p) => p.name.toLowerCase());
  const repeated = names.findIndex((name, i) => names.indexOf(name) !== i);
  if (repeated !== -1) throw new Error(`Two entries are called "${everyone[repeated].name}" — give each a different name`);

  const kept = new Set(everyone.map((p) => p.photo).filter(Boolean));
  return { about, removedPhotos: [...knownPhotos].filter((p) => !kept.has(p)) };
}

module.exports = { ABOUT_PHOTO_FILE, DEFAULTS, mergeAbout, findPerson, applyAboutUpdate };
