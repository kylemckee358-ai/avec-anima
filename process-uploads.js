// Processes uploads from the online admin — run by the GitHub build (.github/workflows/deploy-pages.yml)
// after it has copied the waiting jobs down from the R2 upload bucket:
//
//   node process-uploads.js [uploadsDir]      (default: .uploads)
//
// Each job is a folder: <uploadsDir>/jobs/<jobId>/job.json plus the original files next to it.
// job.json is written last by the admin, so a folder without one is still uploading and is skipped.
//
//   { "type": "gallery",      "category": "previous", "slug": "one-bomb", "files": ["IMG_1.HEIC", ...] }
//   { "type": "poster",       "category": "upcoming", "slug": "...",      "file": "poster.png" }
//   { "type": "artist-photo", "category": "upcoming", "slug": "...",      "artist": "Scon", "file": "scon.jpg" }
//   { "type": "aftermovie",   "category": "previous", "slug": "...",      "file": "film.mov" }
//
// Uses the same processing as the admin on this Mac (lib/media.js). Writes one result per job to
// <uploadsDir>/results/<jobId>.json ({ ok, message }) so the admin can show what happened, and lists
// the finished job ids in <uploadsDir>/processed.txt — the workflow deletes only those from R2.

const fs = require('fs');
const path = require('path');

const { CATEGORIES, eventDir, readEventDetailsRaw, writeManifest } = require('./lib/events-data');
const { replacePoster, addGalleryPhotos, replaceArtistPhoto, processAftermovie } = require('./lib/media');

const uploadsDir = path.resolve(process.argv[2] || '.uploads');
const jobsDir = path.join(uploadsDir, 'jobs');
const resultsDir = path.join(uploadsDir, 'results');

// Only plain filenames inside the job's own folder
function jobFile(jobDir, name) {
  const base = path.basename(String(name || ''));
  const filePath = path.join(jobDir, base);
  if (!base || base === 'job.json' || !fs.existsSync(filePath)) throw new Error(`missing file "${name}"`);
  return { path: filePath, originalname: base };
}

async function runJob(jobDir, job) {
  const { type, category, slug } = job;
  if (!CATEGORIES.includes(category) || !slug || !fs.existsSync(eventDir(category, slug))) {
    throw new Error(`event ${category}/${slug} not found`);
  }

  if (type === 'gallery') {
    const files = [];
    const missing = [];
    for (const name of job.files || []) {
      try { files.push(jobFile(jobDir, name)); } catch { missing.push(path.basename(String(name))); }
    }
    if (!files.length) throw new Error('no photos arrived with this upload');
    const result = await addGalleryPhotos(category, slug, files);
    const { added } = result;
    const failed = [...missing, ...result.failed];
    if (!added) throw new Error(`none of the photos could be read (${failed.join(', ')})`);
    return `Added ${added} photo${added === 1 ? '' : 's'}${failed.length ? ` — couldn't read ${failed.join(', ')}` : ''}`;
  }

  if (type === 'poster') {
    await replacePoster(category, slug, jobFile(jobDir, job.file));
    return 'Poster updated';
  }

  if (type === 'artist-photo') {
    const lineup = (readEventDetailsRaw(category, slug) || {}).lineup || [];
    const index = lineup.findIndex((a) => a.name === job.artist);
    if (index === -1) throw new Error(`${job.artist} isn't in the lineup any more`);
    await replaceArtistPhoto(category, slug, index, jobFile(jobDir, job.file));
    return `Photo updated for ${job.artist}`;
  }

  if (type === 'aftermovie') {
    const size = await processAftermovie(category, slug, jobFile(jobDir, job.file));
    return `After movie updated (${(size / 1024 / 1024).toFixed(1)} MB)`;
  }

  throw new Error(`unknown upload type "${type}"`);
}

(async function main() {
  const jobIds = fs.existsSync(jobsDir)
    ? fs.readdirSync(jobsDir).filter((id) => fs.existsSync(path.join(jobsDir, id, 'job.json'))).sort()
    : [];
  fs.mkdirSync(resultsDir, { recursive: true });

  const processed = [];
  let changed = false;
  for (const id of jobIds) {
    const jobDir = path.join(jobsDir, id);
    let result;
    try {
      const job = JSON.parse(fs.readFileSync(path.join(jobDir, 'job.json'), 'utf8'));
      result = { ok: true, message: await runJob(jobDir, job) };
      changed = true;
    } catch (err) {
      result = { ok: false, message: err.message };
    }
    result.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(resultsDir, `${id}.json`), JSON.stringify(result, null, 2));
    processed.push(id);
    console.log(`${result.ok ? '✓' : '✗'} ${id}: ${result.message}`);
  }

  if (changed) writeManifest();
  fs.writeFileSync(path.join(uploadsDir, 'processed.txt'), processed.join('\n') + (processed.length ? '\n' : ''));
  console.log(`${processed.length} upload job${processed.length === 1 ? '' : 's'} processed`);
})();
