// The admin's upload steps — the same on this Mac (server.js) and online (worker/):
//
//   POST /api/uploads                  { type, category, slug, artist?, files: ['IMG_1.HEIC', ...] }
//                                      → { id, files: ['01-img-1.heic', ...], chunkSize }
//   PUT  /api/uploads/:id/:file        the file itself; bigger than chunkSize → in chunks, adding
//                                      ?part=1..n (+ &uploadId= from part 1's reply) and finishing
//                                      with POST /api/uploads/:id/:file/complete { uploadId, parts }
//   POST /api/uploads/:id/finish       → { status: 'done' | 'failed' | 'processing', message }
//   GET  /api/uploads/:id              → same shape, for checking on a 'processing' upload
//
// Locally the job is processed straight away; online it waits in R2 for the GitHub build
// (process-uploads.js), which writes the result the admin then reads back.

const { CATEGORIES, slugify } = require('./event-rules');

const CHUNK_SIZE = 50 * 1024 * 1024; // online requests are capped at 100 MB
const MAX_GALLERY_FILES = 100;
const JOB_TYPES = ['gallery', 'poster', 'artist-photo', 'aftermovie'];

// Sortable, so jobs are processed in the order they were made
function newJobId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Safe stored name for each original file: "03-img-4512.heic"
function storedNames(originals) {
  return originals.map((name, i) => {
    const original = String(name || 'file');
    const dot = original.lastIndexOf('.');
    const ext = dot > 0 ? original.slice(dot).toLowerCase().replace(/[^.a-z0-9]/g, '') : '';
    const base = slugify(dot > 0 ? original.slice(0, dot) : original).slice(0, 40) || 'file';
    return `${String(i + 1).padStart(2, '0')}-${base}${ext}`;
  });
}

// Checks an upload request and returns the job.json that process-uploads.js will run.
// Throws with a message for the admin if something's wrong.
function planJob(body) {
  const { type, category, slug, artist } = body || {};
  const originals = Array.isArray(body && body.files) ? body.files : [];

  if (!JOB_TYPES.includes(type)) throw new Error('Unknown upload type');
  if (!CATEGORIES.includes(category) || !/^[a-z0-9-]+$/.test(slug || '')) throw new Error('Invalid event');
  if (!originals.length) throw new Error('Choose a file to upload');
  if (type !== 'gallery' && originals.length !== 1) throw new Error('Choose one file');
  if (originals.length > MAX_GALLERY_FILES) throw new Error(`Up to ${MAX_GALLERY_FILES} photos at a time`);
  if (type === 'artist-photo' && !String(artist || '').trim()) throw new Error('Artist name is required');

  const files = storedNames(originals);
  const job = { type, category, slug };
  if (type === 'artist-photo') job.artist = String(artist).trim();
  if (type === 'gallery') job.files = files;
  else job.file = files[0];
  return { job, files };
}

module.exports = { CHUNK_SIZE, JOB_TYPES, newJobId, storedNames, planJob };
