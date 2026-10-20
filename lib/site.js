// Site-wide settings (links + editable text), stored in website/assets/site.json and
// edited from the admin "Site Settings" tab. The build (lib/seo.js) writes them into the
// static HTML so the live pages and search engines see the real values:
//   <a data-site-href="instagramUrl" href="…">  → href set from settings (hidden if empty)
//   <p data-site-text="homeTagline">…</p>       → text set from settings

const fs = require('fs');
const path = require('path');

const SITE_FILE = path.join(__dirname, '..', 'website', 'assets', 'site.json');

const DEFAULTS = {
  siteUrl: 'https://kylemckee358-ai.github.io/avec-anima',
  contactEmail: 'hello@avecanima.com',
  instagramUrl: 'https://www.instagram.com/avec.anima/',
  facebookUrl: 'https://www.facebook.com/profile.php?id=61553040350027',
  storeUrl: 'https://kp1kgw-bb.myshopify.com',
  youtubeChannelUrl: '',
  soundcloudProfileUrl: '',

  about:
    'Avec Anima is an underground house and tech house night on the Isle of Man, ' +
    'running events at venues across the island — from Douglas clubs to one-off nights in the glens.',
  homeTagline: 'Underground house & tech house nights on the Isle of Man. No two are the same.',
  homeVideoText: 'Live sets on YouTube, mixes on SoundCloud — a taste of what Avec Anima sounds like between shows.',
  homeSoundcloudText: 'Mixes from Avec Anima nights, straight from SoundCloud.',
  galleryIntro:
    'After movies and photos from Avec Anima nights across the Isle of Man. Hover over a film to preview it, or tap it to watch with sound.',
  musicIntro:
    'Live sets, warehouse highlights, and a look behind the scenes from Avec Anima nights. New uploads on our YouTube channel after every show.',
  musicSoundcloudText:
    "Mixes from Avec Anima nights and playlists we put together between shows. Full sets, no skips — follow along to hear what's coming before it lands on a lineup.",
  storeComingSoonText: 'The Avec Anima store is on its way. Check back soon.',

  // Google / social-share titles and descriptions per page
  seo: {
    'index.html': {
      title: 'Avec Anima — Underground House & Tech House Nights, Isle of Man',
      description:
        'Avec Anima runs underground house and tech house nights on the Isle of Man. Upcoming events, tickets, live sets and mixes.',
    },
    'events.html': {
      title: 'Events — Avec Anima | House & Tech House Nights, Isle of Man',
      description:
        'Upcoming and previous Avec Anima events — house and tech house nights at venues across the Isle of Man. Dates, lineups and tickets.',
    },
    'gallery.html': {
      title: 'Gallery & After Movies — Avec Anima | Isle of Man',
      description:
        'After movies and photos from Avec Anima house and tech house nights on the Isle of Man. Watch the films and download full-quality photos.',
    },
    'music.html': {
      title: 'Music — Avec Anima | Live Sets & Mixes',
      description:
        'Watch Avec Anima live sets on YouTube and listen back to mixes from our Isle of Man house and tech house nights on SoundCloud.',
    },
  },
};

const LINK_KEYS = ['siteUrl', 'contactEmail', 'instagramUrl', 'facebookUrl', 'storeUrl', 'youtubeChannelUrl', 'soundcloudProfileUrl'];

function readSite() {
  let saved = {};
  if (fs.existsSync(SITE_FILE)) saved = JSON.parse(fs.readFileSync(SITE_FILE, 'utf8'));
  const seo = {};
  for (const page of Object.keys(DEFAULTS.seo)) {
    seo[page] = { ...DEFAULTS.seo[page], ...((saved.seo || {})[page] || {}) };
  }
  return { ...DEFAULTS, ...saved, seo };
}

// Accepts a partial update from the admin form; trims strings and keeps the seo shape
function writeSite(update) {
  const current = readSite();
  const next = { ...current };

  for (const key of Object.keys(DEFAULTS)) {
    if (key === 'seo' || !(key in update)) continue;
    next[key] = String(update[key] ?? '').trim();
  }
  next.siteUrl = next.siteUrl.replace(/\/+$/, '');

  if (update.seo) {
    for (const page of Object.keys(DEFAULTS.seo)) {
      const u = update.seo[page] || {};
      next.seo[page] = {
        title: String(u.title ?? current.seo[page].title).trim() || DEFAULTS.seo[page].title,
        description: String(u.description ?? current.seo[page].description).trim() || DEFAULTS.seo[page].description,
      };
    }
  }

  fs.writeFileSync(SITE_FILE, JSON.stringify(next, null, 2));
  return next;
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function hrefFor(key, value) {
  if (!value) return '#';
  return key === 'contactEmail' ? `mailto:${value}` : value;
}

function applySiteSettings(html, site) {
  // Links: rewrite href, and hide the link entirely when the setting is blank
  html = html.replace(/<a\b([^>]*?)\sdata-site-href="(\w+)"([^>]*)>/g, (tag, before, key, after) => {
    if (!(key in site)) return tag;
    let attrs = `${before} data-site-href="${key}"${after}`
      .replace(/\shref="[^"]*"/, '')
      .replace(/\shidden\b/, '');
    attrs += ` href="${escapeHtml(hrefFor(key, site[key]))}"`;
    if (!site[key]) attrs += ' hidden';
    return `<a${attrs}>`;
  });

  // Text blocks: replace the element's contents (these elements never nest their own tag)
  html = html.replace(/(<(\w+)\b[^>]*\sdata-site-text="(\w+)"[^>]*>)([\s\S]*?)(<\/\2>)/g, (whole, open, tag, key, inner, close) => {
    if (typeof site[key] !== 'string') return whole;
    return `${open}${escapeHtml(site[key])}${close}`;
  });

  return html;
}

module.exports = { readSite, writeSite, applySiteSettings, DEFAULTS, LINK_KEYS };
