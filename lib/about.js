// About page content (intro + resident artists), stored in website/assets/about/about.json
// and edited from the admin "About" tab. The build (lib/seo.js) writes it into about.html.
// The rules themselves are in lib/about-rules.js, shared with the online admin.

const fs = require('fs');
const path = require('path');
const { mergeAbout, applyAboutUpdate } = require('./about-rules');

const ABOUT_DIR = path.join(__dirname, '..', 'website', 'assets', 'about');
const ABOUT_FILE = path.join(ABOUT_DIR, 'about.json');

function readAbout() {
  return mergeAbout(fs.existsSync(ABOUT_FILE) ? JSON.parse(fs.readFileSync(ABOUT_FILE, 'utf8')) : null);
}

function saveAbout(about) {
  fs.mkdirSync(ABOUT_DIR, { recursive: true });
  fs.writeFileSync(ABOUT_FILE, JSON.stringify(about, null, 2));
}

function removePhoto(file) {
  const p = path.join(ABOUT_DIR, path.basename(file));
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function writeAbout(update) {
  const { about, removedPhotos } = applyAboutUpdate(readAbout(), update);
  saveAbout(about);
  removedPhotos.forEach(removePhoto);
  return about;
}

module.exports = { ABOUT_DIR, readAbout, saveAbout, writeAbout, removePhoto };
