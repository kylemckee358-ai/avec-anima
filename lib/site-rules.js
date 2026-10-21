// Site settings rules with no file access — shared by lib/site.js (local admin + build)
// and the online admin (worker/), which reads and writes site.json through GitHub instead.

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
  homeVideoText: "Live sets on YouTube, curated playlists from our selectors on SoundCloud — a taste of what Avec Anima sounds like between shows.",
  homeSoundcloudText:
    "Not recordings from our nights — these are playlists carefully curated by the Avec Anima selectors. Every track is hand-picked and sequenced by the people behind the decks: the underground house and tech house they're playing, digging for and can't stop coming back to. Press play and let it run.",
  galleryIntro:
    'After movies and photos from Avec Anima nights across the Isle of Man. Hover over a film to preview it, or tap it to watch with sound.',
  musicIntro:
    'Live sets, warehouse highlights, and a look behind the scenes from Avec Anima nights. New uploads on our YouTube channel after every show.',
  musicSoundcloudText:
    "Playlists carefully curated by the Avec Anima selectors — not recordings from our nights, but hand-picked, properly sequenced selections of the underground house and tech house they're playing and digging for right now. Follow along to hear the sounds that shape our lineups before they land on the dancefloor.",
  storeComingSoonText: 'The Avec Anima store is on its way. Check back soon.',

  // Google / social-share titles and descriptions per page
  seo: {
    'index.html': {
      title: 'Avec Anima — Underground House & Tech House Nights, Isle of Man',
      description:
        'Avec Anima runs underground house and tech house nights on the Isle of Man. Upcoming events, tickets, live sets and curated playlists.',
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
      title: 'Music — Avec Anima | Live Sets & Playlists',
      description:
        'Watch Avec Anima live sets on YouTube and listen to playlists curated by our selectors on SoundCloud — underground house and tech house from the Isle of Man.',
    },
  },
};

const LINK_KEYS = ['siteUrl', 'contactEmail', 'instagramUrl', 'facebookUrl', 'storeUrl', 'youtubeChannelUrl', 'soundcloudProfileUrl'];

// Saved settings with defaults filled in for anything missing
function mergeSite(saved = {}) {
  const seo = {};
  for (const page of Object.keys(DEFAULTS.seo)) {
    seo[page] = { ...DEFAULTS.seo[page], ...((saved.seo || {})[page] || {}) };
  }
  return { ...DEFAULTS, ...saved, seo };
}

// Applies a partial update from the admin form; trims strings and keeps the seo shape
function applySiteUpdate(current, update) {
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

module.exports = { DEFAULTS, LINK_KEYS, mergeSite, applySiteUpdate, applySiteSettings };
