// Avec Anima online admin — https://avec-anima-admin.avecanima.workers.dev
//
// Serves the same admin page as `node server.js`, from any browser:
//   /api/*   the admin API (api.js) — saves to GitHub, uploads go to R2 for the GitHub build
//   *.html   admin.html from the repo; any other page redirects to the live site
//   other    files from the repo's website/ folder (styles, scripts, posters, photos, films)
//
// Sign-in is Cloudflare Access (one-time code by email). Every request must carry a valid
// Access token for this app, or nothing is served — so until Access is switched on
// (ACCESS_TEAM_DOMAIN + ACCESS_AUD set), the admin stays locked.

import * as api from './api.js';
import { verifyAccess } from './access.js';

const TYPES = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  svg: 'image/svg+xml',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  ico: 'image/x-icon',
  mp4: 'video/mp4',
  woff2: 'font/woff2',
};

const ROUTES = [
  ['GET', /^\/api\/info$/, (c) => ({ mode: 'online', user: c.user, siteUrl: c.env.SITE_URL })],
  ['GET', /^\/api\/events$/, (c) => api.listEvents(c.env)],
  ['POST', /^\/api\/events$/, async (c) => api.createEvent(c.env, c.user, await c.body())],
  ['PUT', /^\/api\/events\/([a-z]+)\/([a-z0-9-]+)$/, async (c, cat, slug) => api.updateEvent(c.env, c.user, cat, slug, await c.body())],
  ['DELETE', /^\/api\/events\/([a-z]+)\/([a-z0-9-]+)$/, (c, cat, slug) => api.deleteEvent(c.env, c.user, cat, slug)],
  ['POST', /^\/api\/events\/([a-z]+)\/([a-z0-9-]+)\/move$/, async (c, cat, slug) => api.moveEvent(c.env, c.user, cat, slug, await c.body())],
  ['POST', /^\/api\/events\/([a-z]+)\/([a-z0-9-]+)\/lineup$/, async (c, cat, slug) => api.addArtist(c.env, c.user, cat, slug, await c.body())],
  ['PUT', /^\/api\/events\/([a-z]+)\/([a-z0-9-]+)\/lineup$/, async (c, cat, slug) => api.saveLineup(c.env, c.user, cat, slug, await c.body())],
  ['DELETE', /^\/api\/events\/([a-z]+)\/([a-z0-9-]+)\/aftermovie$/, (c, cat, slug) => api.deleteFilm(c.env, c.user, cat, slug)],
  ['POST', /^\/api\/events\/([a-z]+)\/([a-z0-9-]+)\/gallery\/delete$/, async (c, cat, slug) => api.deletePhotos(c.env, c.user, cat, slug, await c.body())],
  ['PUT', /^\/api\/events\/([a-z]+)\/([a-z0-9-]+)\/gallery\/order$/, async (c, cat, slug) => api.reorderPhotos(c.env, c.user, cat, slug, await c.body())],

  ['GET', /^\/api\/site$/, (c) => api.readSite(c.env)],
  ['PUT', /^\/api\/site$/, async (c) => api.writeSite(c.env, c.user, await c.body())],
  ['GET', /^\/api\/music\/videos$/, (c) => api.readMusic(c.env, 'videos.json', [])],
  ['PUT', /^\/api\/music\/videos$/, async (c) => api.writeMusic(c.env, c.user, 'videos.json', await c.body(), 'Update YouTube videos')],
  ['GET', /^\/api\/music\/soundcloud$/, (c) => api.readMusic(c.env, 'soundcloud.json', {})],
  ['PUT', /^\/api\/music\/soundcloud$/, async (c) => api.writeMusic(c.env, c.user, 'soundcloud.json', await c.body(), 'Update SoundCloud playlists')],

  ['GET', /^\/api\/uploads$/, (c) => api.pendingUploads(c.env)],
  ['POST', /^\/api\/uploads$/, async (c) => api.startUpload(c.env, await c.body())],
  ['POST', /^\/api\/uploads\/([a-z0-9-]+)\/finish$/, (c, id) => api.finishUpload(c.env, id)],
  ['GET', /^\/api\/uploads\/([a-z0-9-]+)$/, (c, id) => api.uploadStatus(c.env, id)],
  ['PUT', /^\/api\/uploads\/([a-z0-9-]+)\/([a-z0-9.-]+)$/, (c, id, file) => api.receiveFile(c.env, c.request, id, file, c.url)],
  ['POST', /^\/api\/uploads\/([a-z0-9-]+)\/([a-z0-9.-]+)\/complete$/, async (c, id, file) => api.completeFile(c.env, id, file, await c.body())],
];

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function handleApi(request, env, url, user) {
  for (const [method, pattern, handler] of ROUTES) {
    if (method !== request.method) continue;
    const match = url.pathname.match(pattern);
    if (!match) continue;
    const context = {
      env,
      user,
      request,
      url,
      body: () => request.json().catch(() => { throw new api.HttpError(400, 'Expected JSON'); }),
    };
    try {
      return jsonResponse(await handler(context, ...match.slice(1)));
    } catch (err) {
      if (!(err instanceof api.HttpError)) console.error(err);
      return jsonResponse({ error: err.message || 'Something went wrong' }, err.status && err.status < 500 ? err.status : 500);
    }
  }
  return jsonResponse({ error: 'Not found' }, 404);
}

// Site files straight from the repo. Uploaded media always gets a new filename,
// so GitHub's 5-minute file cache never shows a stale photo.
async function serveFile(request, env, url) {
  const path = decodeURIComponent(url.pathname);
  if (path === '/') return Response.redirect(`${url.origin}/admin.html`, 302);
  if (path.endsWith('.html') && path !== '/admin.html') {
    return Response.redirect(`${env.SITE_URL}${path}`, 302);
  }

  const raw = `https://raw.githubusercontent.com/${env.GITHUB_REPO}/${env.GITHUB_BRANCH || 'main'}/website${path}`;
  const upstream = await fetch(raw, { headers: request.headers.has('Range') ? { Range: request.headers.get('Range') } : {} });
  if (!upstream.ok && upstream.status !== 206) return new Response('Not found', { status: 404 });

  const ext = path.split('.').pop().toLowerCase();
  const headers = new Headers({
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': ['html', 'js', 'css', 'json'].includes(ext) ? 'no-cache' : 'public, max-age=3600',
  });
  for (const h of ['Content-Length', 'Content-Range', 'Accept-Ranges', 'ETag']) {
    if (upstream.headers.has(h)) headers.set(h, upstream.headers.get(h));
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const user = await verifyAccess(request, env);
    if (!user) {
      const message = 'The Avec Anima admin is locked — sign-in isn\'t set up yet, or your sign-in has expired. Reload the page to sign in again.';
      return url.pathname.startsWith('/api/')
        ? jsonResponse({ error: message }, 403)
        : new Response(message, { status: 403, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
    if (url.pathname.startsWith('/api/')) return handleApi(request, env, url, user);
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    return serveFile(request, env, url);
  },
};
