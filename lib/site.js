// Site-wide settings (links + editable text), stored in website/assets/site.json and
// edited from the admin "Site Settings" tab. The build (lib/seo.js) writes them into the
// static HTML so the live pages and search engines see the real values:
//   <a data-site-href="instagramUrl" href="…">  → href set from settings (hidden if empty)
//   <p data-site-text="homeTagline">…</p>       → text set from settings

const fs = require('fs');
const path = require('path');
const { DEFAULTS, LINK_KEYS, mergeSite, applySiteUpdate, applySiteSettings } = require('./site-rules');

const SITE_FILE = path.join(__dirname, '..', 'website', 'assets', 'site.json');

function readSite() {
  return mergeSite(fs.existsSync(SITE_FILE) ? JSON.parse(fs.readFileSync(SITE_FILE, 'utf8')) : {});
}

function writeSite(update) {
  const next = applySiteUpdate(readSite(), update);
  fs.writeFileSync(SITE_FILE, JSON.stringify(next, null, 2));
  return next;
}

module.exports = { readSite, writeSite, applySiteSettings, DEFAULTS, LINK_KEYS };
