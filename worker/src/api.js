// The admin API, online. Same endpoints and replies as server.js, but every change is a
// commit to GitHub (which rebuilds and publishes the site) and uploads wait in R2 for the
// GitHub build to process them (process-uploads.js).

import { GitHub, Conflict } from './github.js';
import eventRules from '../../lib/event-rules.js';
import siteRules from '../../lib/site-rules.js';
import uploadRules from '../../lib/upload-rules.js';

const { CATEGORIES, AFTERMOVIE_FILE, AFTERMOVIE_POSTER_FILE, PHOTO_FILE, slugify, orderPhotos, scanEvents } = eventRules;
const { mergeSite, applySiteUpdate } = siteRules;
const { CHUNK_SIZE, newJobId, planJob } = uploadRules;

const EVENTS = 'website/assets/events';
const SITE_FILE = 'website/assets/site.json';
const MUSIC = 'website/assets/music';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (value) => JSON.stringify(value, null, 2);
const eventPath = (category, slug) => `${EVENTS}/${category}/${slug}`;

function checkCategory(category) {
  if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Invalid category');
}

// Newest of a set of media files: ones with an upload id (poster-<id>.jpg) beat the plain
// name, and ids sort by time. Normally there's only one.
function newestName(names) {
  return [...names].sort((a, b) => Number(b.includes('-')) - Number(a.includes('-')) || b.localeCompare(a))[0];
}

// The events folder in a snapshot, in the shape lib/event-rules.js expects
async function eventStore(snap) {
  const paths = [];
  for (const category of CATEGORIES) {
    for (const slug of snap.children(`${EVENTS}/${category}`).dirs) {
      paths.push(`${eventPath(category, slug)}/event-details.json`, `${eventPath(category, slug)}/gallery/order.json`);
    }
  }
  await snap.load(paths);
  return {
    listDirs: (rel) => snap.children(`${EVENTS}/${rel}`).dirs,
    listFiles: (rel) => snap.children(`${EVENTS}/${rel}`).files,
    readJson: (rel) => snap.json(`${EVENTS}/${rel}`),
    newest: (rel, names) => newestName(names),
  };
}

async function readDetails(snap, category, slug) {
  checkCategory(category);
  const details = await snap.readJson(`${eventPath(category, slug)}/event-details.json`);
  if (!details) throw new HttpError(404, 'Event not found');
  return details;
}

function uniqueSlug(snap, category, baseSlug) {
  const taken = new Set(snap.children(`${EVENTS}/${category}`).dirs);
  let slug = baseSlug || 'event';
  for (let i = 2; taken.has(slug); i += 1) slug = `${baseSlug}-${i}`;
  return slug;
}

// Runs a change against the latest commit, retrying if someone else saved in between
// (with a short random wait, so saves landing together spread out instead of colliding again).
// fn(snap) returns { changes: Map, message, result }.
async function save(env, user, fn) {
  const github = new GitHub(env);
  for (let attempt = 1; ; attempt += 1) {
    const snap = await github.snapshot();
    const { changes, message, result } = await fn(snap);
    if (!changes.size) return result;
    try {
      await github.commit(snap, changes, `${message}\n\nSaved in the online admin${user ? ` by ${user}` : ''}`);
      return result;
    } catch (err) {
      if (!(err instanceof Conflict) || attempt === 6) throw err;
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt + Math.random() * 700));
    }
  }
}

// ── Events ─────────────────────────────────────────────────────────────

const EVENT_FIELDS = ['name', 'date', 'startTime', 'endTime', 'location', 'ticketLink', 'description', 'driveLink'];

export async function listEvents(env) {
  const snap = await new GitHub(env).snapshot();
  return scanEvents(await eventStore(snap), { includeIncomplete: true });
}

export function createEvent(env, user, body) {
  const { category, name, date } = body;
  checkCategory(category);
  if (!name || !date) throw new HttpError(400, 'Name and date are required');

  return save(env, user, async (snap) => {
    const slug = uniqueSlug(snap, category, slugify(name));
    const lineup = (Array.isArray(body.lineup) ? body.lineup : [])
      .map((artist) => String(artist || '').trim())
      .filter(Boolean)
      .map((artist) => ({ name: artist, photo: null }));
    const details = {
      name,
      date,
      startTime: body.startTime || '',
      endTime: body.endTime || '',
      location: body.location || '',
      ticketLink: body.ticketLink || '#',
      description: body.description || '',
      lineup,
    };
    return {
      changes: new Map([[`${eventPath(category, slug)}/event-details.json`, json(details)]]),
      message: `Add event "${name}"`,
      result: { ok: true, category, slug },
    };
  });
}

export function updateEvent(env, user, category, slug, body) {
  return save(env, user, async (snap) => {
    const existing = await readDetails(snap, category, slug);
    const updated = { ...existing };
    for (const field of EVENT_FIELDS) {
      if (body[field] !== undefined && body[field] !== null) updated[field] = body[field];
    }
    if (updated.driveLink === undefined) updated.driveLink = '';
    return {
      changes: new Map([[`${eventPath(category, slug)}/event-details.json`, json(updated)]]),
      message: `Update "${updated.name}"`,
      result: { ok: true },
    };
  });
}

export function addArtist(env, user, category, slug, body) {
  const name = String(body.name || '').trim();
  if (!name) throw new HttpError(400, 'Artist name is required');
  return save(env, user, async (snap) => {
    const details = await readDetails(snap, category, slug);
    details.lineup = [...(details.lineup || []), { name, photo: null }];
    return {
      changes: new Map([[`${eventPath(category, slug)}/event-details.json`, json(details)]]),
      message: `Add ${name} to "${details.name}"`,
      result: { ok: true, index: details.lineup.length - 1 },
    };
  });
}

export function saveLineup(env, user, category, slug, body) {
  if (!Array.isArray(body)) throw new HttpError(400, 'Expected a list of artists');
  return save(env, user, async (snap) => {
    const details = await readDetails(snap, category, slug);
    const dir = eventPath(category, slug);

    // Only keep photo paths that already belong to this event's lineup
    const knownPhotos = new Set((details.lineup || []).map((a) => a.photo).filter(Boolean));
    const lineup = body
      .map((a) => ({ name: String(a.name || '').trim(), photo: knownPhotos.has(a.photo) ? a.photo : null }))
      .filter((a) => a.name);

    // Delete headshots for artists that were removed
    const changes = new Map();
    const kept = new Set(lineup.map((a) => a.photo).filter(Boolean));
    for (const photo of knownPhotos) {
      if (!kept.has(photo) && snap.has(`${dir}/${photo}`)) changes.set(`${dir}/${photo}`, null);
    }

    details.lineup = lineup;
    changes.set(`${dir}/event-details.json`, json(details));
    return { changes, message: `Update lineup for "${details.name}"`, result: { ok: true } };
  });
}

export function moveEvent(env, user, category, slug, body) {
  const { toCategory } = body;
  checkCategory(category);
  checkCategory(toCategory);
  if (category === toCategory) return { ok: true };

  return save(env, user, async (snap) => {
    const details = await readDetails(snap, category, slug);
    const from = eventPath(category, slug);
    const to = eventPath(toCategory, uniqueSlug(snap, toCategory, slug));
    const changes = new Map();
    for (const path of snap.under(from)) {
      changes.set(to + path.slice(from.length), { sha: snap.files.get(path) });
      changes.set(path, null);
    }
    return { changes, message: `Move "${details.name}" to ${toCategory}`, result: { ok: true } };
  });
}

export function deleteEvent(env, user, category, slug) {
  return save(env, user, async (snap) => {
    const details = await readDetails(snap, category, slug);
    const changes = new Map(snap.under(eventPath(category, slug)).map((path) => [path, null]));
    return { changes, message: `Delete event "${details.name}"`, result: { ok: true } };
  });
}

export function deleteFilm(env, user, category, slug) {
  return save(env, user, async (snap) => {
    const details = await readDetails(snap, category, slug);
    const dir = eventPath(category, slug);
    const changes = new Map();
    for (const file of snap.children(dir).files) {
      if (AFTERMOVIE_FILE.test(file) || AFTERMOVIE_POSTER_FILE.test(file)) changes.set(`${dir}/${file}`, null);
    }
    delete details.aftermovieOrientation;
    changes.set(`${dir}/event-details.json`, json(details));
    return { changes, message: `Remove after movie from "${details.name}"`, result: { ok: true } };
  });
}

async function currentPhotoOrder(snap, gallery) {
  return orderPhotos(snap.children(gallery).files, await snap.readJson(`${gallery}/order.json`));
}

export function deletePhotos(env, user, category, slug, body) {
  const files = (Array.isArray(body.files) ? body.files : []).filter((f) => PHOTO_FILE.test(f));
  return save(env, user, async (snap) => {
    const details = await readDetails(snap, category, slug);
    const gallery = `${eventPath(category, slug)}/gallery`;
    const changes = new Map();
    for (const file of files) {
      for (const path of [`${gallery}/${file}`, `${gallery}/thumbs/${file}`]) {
        if (snap.has(path)) changes.set(path, null);
      }
    }
    const removed = new Set(files);
    changes.set(`${gallery}/order.json`, json((await currentPhotoOrder(snap, gallery)).filter((f) => !removed.has(f))));
    return {
      changes,
      message: `Delete ${files.length} photo${files.length === 1 ? '' : 's'} from "${details.name}"`,
      result: { ok: true, removed: files.length },
    };
  });
}

export function reorderPhotos(env, user, category, slug, body) {
  const order = Array.isArray(body.files) ? body.files : [];
  return save(env, user, async (snap) => {
    const details = await readDetails(snap, category, slug);
    const gallery = `${eventPath(category, slug)}/gallery`;
    const existing = await currentPhotoOrder(snap, gallery);

    // Must be exactly the current set of photos, just reordered
    if (order.length !== existing.length || [...order].sort().join() !== [...existing].sort().join()) {
      throw new HttpError(400, 'Photo list is out of date — refresh and try again');
    }
    return {
      changes: new Map([[`${gallery}/order.json`, json(order)]]),
      message: `Reorder photos for "${details.name}"`,
      result: { ok: true },
    };
  });
}

// ── Site settings + music ──────────────────────────────────────────────

export async function readSite(env) {
  const snap = await new GitHub(env).snapshot();
  return mergeSite((await snap.readJson(SITE_FILE)) || {});
}

export function writeSite(env, user, body) {
  return save(env, user, async (snap) => {
    const next = applySiteUpdate(mergeSite((await snap.readJson(SITE_FILE)) || {}), body || {});
    return { changes: new Map([[SITE_FILE, json(next)]]), message: 'Update site settings', result: { ok: true, site: next } };
  });
}

export async function readMusic(env, file, fallback) {
  const snap = await new GitHub(env).snapshot();
  return (await snap.readJson(`${MUSIC}/${file}`)) ?? fallback;
}

export function writeMusic(env, user, file, body, message) {
  return save(env, user, async () => ({
    changes: new Map([[`${MUSIC}/${file}`, json(body)]]),
    message,
    result: { ok: true },
  }));
}

// ── Uploads (steps in lib/upload-rules.js) ─────────────────────────────
// R2 layout: plans/<id>.json (what's expected), jobs/<id>/<files> + job.json (once finished,
// for the build), results/<id>.json (written by the build). Everything expires after 7 days.

function uploadLabel(job) {
  if (job.type === 'gallery') return `${job.files.length} photo${job.files.length === 1 ? '' : 's'}`;
  if (job.type === 'artist-photo') return `${job.artist}'s headshot`;
  return job.type === 'aftermovie' ? 'film' : 'poster';
}

function checkId(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new HttpError(400, 'Invalid upload');
}

async function readPlan(env, id) {
  checkId(id);
  const obj = await env.UPLOADS.get(`plans/${id}.json`);
  if (!obj) throw new HttpError(404, 'Upload not found');
  return obj.json();
}

export async function startUpload(env, body) {
  let plan;
  try {
    plan = planJob(body);
  } catch (err) {
    throw new HttpError(400, err.message);
  }
  const snap = await new GitHub(env).snapshot();
  await readDetails(snap, plan.job.category, plan.job.slug);

  const id = newJobId();
  await env.UPLOADS.put(`plans/${id}.json`, JSON.stringify(plan));
  return { id, files: plan.files, chunkSize: Number(env.CHUNK_SIZE) || CHUNK_SIZE };
}

// A whole file, or one chunk of a big one (R2 multipart upload, all parts but the last the same size)
export async function receiveFile(env, request, id, file, url) {
  const plan = await readPlan(env, id);
  if (!plan.files.includes(file)) throw new HttpError(404, 'Upload not found');
  const key = `jobs/${id}/${file}`;

  const part = Number(url.searchParams.get('part')) || 0;
  if (!part) {
    await env.UPLOADS.put(key, request.body);
    return { ok: true };
  }
  const uploadId = url.searchParams.get('uploadId');
  const upload = uploadId ? env.UPLOADS.resumeMultipartUpload(key, uploadId) : await env.UPLOADS.createMultipartUpload(key);
  const uploaded = await upload.uploadPart(part, request.body);
  return { ok: true, uploadId: upload.uploadId, etag: uploaded.etag };
}

export async function completeFile(env, id, file, body) {
  const plan = await readPlan(env, id);
  if (!plan.files.includes(file)) throw new HttpError(404, 'Upload not found');
  const upload = env.UPLOADS.resumeMultipartUpload(`jobs/${id}/${file}`, body.uploadId);
  await upload.complete((body.parts || []).map((p) => ({ partNumber: Number(p.partNumber), etag: p.etag })));
  return { ok: true };
}

// job.json goes in last — the build skips jobs without one — then the build is started
export async function finishUpload(env, id) {
  const plan = await readPlan(env, id);
  for (const file of plan.files) {
    if (!(await env.UPLOADS.head(`jobs/${id}/${file}`))) throw new HttpError(400, `${file} didn't finish uploading — try again`);
  }
  await env.UPLOADS.put(`jobs/${id}/job.json`, JSON.stringify(plan.job));
  if (env.NO_DISPATCH !== 'true') await new GitHub(env).dispatch('process-uploads');
  return { status: 'processing', message: `Processing ${uploadLabel(plan.job)}` };
}

export async function uploadStatus(env, id) {
  checkId(id);
  const result = await env.UPLOADS.get(`results/${id}.json`);
  if (result) {
    const { ok, message } = await result.json();
    return { status: ok ? 'done' : 'failed', message };
  }
  if (await env.UPLOADS.head(`jobs/${id}/job.json`)) return { status: 'processing', message: 'Processing' };
  return { status: 'failed', message: 'Upload not found — it may have expired' };
}

// Finished uploads the build hasn't processed yet
export async function pendingUploads(env) {
  const listed = await env.UPLOADS.list({ prefix: 'jobs/', delimiter: '/' });
  const processing = [];
  for (const prefix of listed.delimitedPrefixes) {
    const job = await env.UPLOADS.get(`${prefix}job.json`);
    if (job) processing.push({ id: prefix.slice('jobs/'.length, -1), label: uploadLabel(await job.json()) });
  }
  return { processing };
}
