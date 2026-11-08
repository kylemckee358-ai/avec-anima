// Search engine + AI crawler support for the static site.
// Runs after every manifest rebuild (see writeManifest in events-data.js) and:
//   - fills the <!-- seo --> block in each page's <head> (title, description, canonical, social cards, schema)
//   - pre-renders event cards into index.html / events.html so crawlers see them without JavaScript
//   - writes a static page per event to website/events/<slug>.html
//   - writes sitemap.xml, robots.txt and llms.txt
//   - applies site settings (links + editable text, see lib/site.js) to every page
//
// Moving to a custom domain? Change "Site address" in admin → Site Settings.

const fs = require('fs');
const path = require('path');
const { renderEventCard, renderUpcomingEmpty, artistNames, artistSlug, photoCropStyle } = require('../website/js/event-card');
const { renderEventDetail, renderHomeUpcoming } = require('../website/js/event-detail');
const { renderGallery, eventsWithMedia } = require('../website/js/gallery');
const { readSite, applySiteSettings } = require('./site');
const { readAbout } = require('./about');
const { extractYouTubeId } = require('../website/js/media-helpers');

const SITE_NAME = 'Avec Anima';
const DEFAULT_IMAGE = 'assets/og-image.jpg';
const WEBSITE_DIR = path.join(__dirname, '..', 'website');
const EVENT_PAGES_DIR = path.join(WEBSITE_DIR, 'events');

// Settings for the current build — loaded fresh by writeSeoFiles() each time
let site = readSite();
let about = readAbout();
let lastManifest = { upcoming: [], previous: [] };

function socialProfiles() {
  return [site.instagramUrl, site.facebookUrl, site.youtubeChannelUrl, site.soundcloudProfileUrl].filter(Boolean);
}

// Static pages. `sitemap: false` keeps a page out of the sitemap and tells search engines not to index it.
// Titles/descriptions for the main pages come from site settings (admin → Site Settings → Google).
const PAGES = {
  'index.html': {
    path: '',
    title: 'Avec Anima — Underground House & Tech House Nights, Isle of Man',
    description:
      'Avec Anima runs underground house and tech house nights on the Isle of Man. Upcoming events, tickets, live sets and mixes.',
  },
  'events.html': {
    path: 'events.html',
    title: 'Events — Avec Anima | House & Tech House Nights, Isle of Man',
    description:
      'Upcoming and previous Avec Anima events — house and tech house nights at venues across the Isle of Man. Dates, lineups and tickets.',
  },
  'gallery.html': {
    path: 'gallery.html',
    title: 'Gallery & After Movies — Avec Anima | Isle of Man',
    description:
      'After movies and photos from Avec Anima house and tech house nights on the Isle of Man. Watch the films and download full-quality photos.',
  },
  'music.html': {
    path: 'music.html',
    title: 'Music — Avec Anima | Live Sets & Mixes',
    description:
      'Watch Avec Anima live sets on YouTube and listen back to mixes from our Isle of Man house and tech house nights on SoundCloud.',
  },
  'about.html': {
    path: 'about.html',
    title: 'About — Avec Anima | Resident Artists, Isle of Man',
    description:
      'The story behind Avec Anima, underground house and tech house nights on the Isle of Man, and the resident artists who play them.',
  },
  'store.html': {
    path: 'store.html',
    title: 'Store — Avec Anima',
    description: 'Avec Anima merch — coming soon.',
    sitemap: false,
  },
  'event.html': {
    path: 'event.html',
    title: 'Event — Avec Anima',
    description: 'Avec Anima event details.',
    sitemap: false,
  },
};

// ── Helpers ──────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function absoluteUrl(relPath) {
  return `${site.siteUrl}/${relPath}`;
}

function jsonLd(data) {
  // Escape "<" so a description can never close the script tag early
  return `<script type="application/ld+json">${JSON.stringify(data, null, 2).replace(/</g, '\\u003c')}</script>`;
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

// Isle of Man uses UK time: BST (+01:00) from the last Sunday of March to the last Sunday of October
function lastSunday(year, monthIndex) {
  const d = new Date(Date.UTC(year, monthIndex + 1, 0));
  d.setUTCDate(d.getUTCDate() - d.getUTCDay());
  return d;
}

function ukOffset(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return d >= lastSunday(year, 2) && d < lastSunday(year, 9) ? '+01:00' : '+00:00';
}

function isoDateTime(dateStr, time) {
  if (!time) return dateStr;
  return `${dateStr}T${time}:00${ukOffset(dateStr)}`;
}

function addDays(dateStr, days) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function formatDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function hasTicketLink(event) {
  return Boolean(event.ticketLink) && event.ticketLink !== '#';
}

// ── <head> tags ──────────────────────────────────────────────────────

function headTags({ title, description, url, image, indexable = true, schema = [] }) {
  const lines = [
    `<title>${escapeHtml(title)}</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    indexable ? `<link rel="canonical" href="${url}">` : '<meta name="robots" content="noindex, follow">',
    '<meta name="theme-color" content="#0A0A0A">',
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    '<meta property="og:locale" content="en_GB">',
    '<meta property="og:type" content="website">',
    `<meta property="og:title" content="${escapeHtml(title)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${image}">`,
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeHtml(title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(description)}">`,
    `<meta name="twitter:image" content="${image}">`,
    ...schema.map(jsonLd),
  ];
  return lines.join('\n  ');
}

function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${site.siteUrl}/#organization`,
    name: SITE_NAME,
    url: `${site.siteUrl}/`,
    logo: absoluteUrl('assets/logo.png'),
    email: site.contactEmail || undefined,
    description: site.about,
    areaServed: { '@type': 'Place', name: 'Isle of Man' },
    sameAs: socialProfiles(),
  };
}

function websiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: `${site.siteUrl}/`,
    publisher: { '@id': `${site.siteUrl}/#organization` },
  };
}

function eventSchema(event, isPrevious) {
  const [venue, ...rest] = (event.location || '').split(',').map((s) => s.trim()).filter(Boolean);
  const locality = rest.length > 1 ? rest[0] : null;
  const endDate = event.endTime && event.startTime && event.endTime < event.startTime
    ? addDays(event.date, 1) // finishes after midnight
    : event.date;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'MusicEvent',
    name: event.name,
    description: event.description || undefined,
    url: absoluteUrl(event.page),
    image: [absoluteUrl(event.poster)],
    startDate: isoDateTime(event.date, event.startTime),
    endDate: event.endTime ? isoDateTime(endDate, event.endTime) : undefined,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    location: {
      '@type': 'Place',
      name: venue || 'Isle of Man',
      address: {
        '@type': 'PostalAddress',
        addressLocality: locality || undefined,
        addressRegion: 'Isle of Man',
        addressCountry: 'IM',
      },
    },
    organizer: { '@type': 'Organization', name: SITE_NAME, url: `${site.siteUrl}/` },
    performer: (event.lineup || []).map((a) => ({ '@type': 'MusicGroup', name: a.name })),
  };

  if (!isPrevious && hasTicketLink(event)) {
    schema.offers = {
      '@type': 'Offer',
      url: event.ticketLink,
      availability: 'https://schema.org/InStock',
    };
  }

  return schema;
}

function videoSchema(event) {
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: `${event.name} — After Movie`,
    description: event.description || `After movie from ${event.name}, ${formatDate(event.date)}.`,
    thumbnailUrl: [absoluteUrl(event.aftermoviePoster || event.poster)],
    uploadDate: isoDateTime(event.date, event.startTime),
    contentUrl: absoluteUrl(event.aftermovie),
    url: `${absoluteUrl('gallery.html')}#${event.slug}`,
  };
}

// ── Page writers ─────────────────────────────────────────────────────

function replaceBlock(html, startMarker, endMarker, content, file) {
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start);
  if (start === -1 || end === -1) {
    console.warn(`seo: markers ${startMarker} not found in ${file} — skipped`);
    return html;
  }
  return html.slice(0, start + startMarker.length) + content + html.slice(end);
}

// css/style.css → css/style.css?v=<hash of the file>, same for js/*.js, so browsers fetch the new
// file right after a deploy instead of reusing a cached one (GitHub Pages lets them keep it 10 min)
const assetHashes = new Map();
function assetVersion(rel) {
  if (!assetHashes.has(rel)) {
    const file = path.join(WEBSITE_DIR, rel);
    const hash = fs.existsSync(file)
      ? require('crypto').createHash('md5').update(fs.readFileSync(file)).digest('hex').slice(0, 8)
      : '';
    assetHashes.set(rel, hash);
  }
  return assetHashes.get(rel);
}

function versionAssets(html) {
  return html.replace(/(href|src)="((?:css|js)\/[\w.-]+\.(?:css|js))(?:\?v=[\w]*)?"/g, (whole, attr, rel) => {
    const v = assetVersion(rel);
    return v ? `${attr}="${rel}?v=${v}"` : whole;
  });
}

function fillSeoBlock(html, tags, file) {
  return replaceBlock(html, '<!-- seo -->', '<!-- /seo -->', `\n  ${tags}\n  `, file);
}

function fillPrerender(html, id, content, file) {
  return replaceBlock(html, `<!-- prerender:${id} -->`, '<!-- /prerender -->', `\n      ${content.trim()}\n      `, file);
}

// Page banners: a dimmed strip of images behind the title (see .page-hero in style.css).
// Events uses its posters, Gallery its film stills, Music its YouTube thumbnails.
function heroStrip(images) {
  return images.filter(Boolean).slice(0, 6).map((src) => `<img src="${src}" alt="">`).join('');
}

function galleryStats(withMedia) {
  if (!withMedia.length) return '';
  const films = withMedia.filter((e) => e.aftermovie).length;
  const photos = withMedia.reduce((n, e) => n + (e.gallery || []).length, 0);
  const parts = [];
  if (films) parts.push(`${films} after movie${films === 1 ? '' : 's'}`);
  if (photos) parts.push(`${photos} photo${photos === 1 ? '' : 's'}`);
  parts.push(`${withMedia.length} night${withMedia.length === 1 ? '' : 's'}`);
  return parts.join(' &middot; ');
}

// YouTube thumbnails first, then after movie stills to fill the strip
function musicHeroImages(manifest) {
  let videos = [];
  try {
    videos = JSON.parse(fs.readFileSync(path.join(WEBSITE_DIR, 'assets', 'music', 'videos.json'), 'utf8'));
  } catch (err) {
    // no videos yet
  }
  const thumbs = videos
    .map((v) => v.youtubeId || extractYouTubeId(v.youtubeUrl))
    .filter(Boolean)
    .map((id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`);
  const stills = eventsWithMedia(manifest).map((e) => e.aftermoviePoster).filter(Boolean);
  return [...thumbs, ...stills];
}

function eventsStats({ upcoming, previous }) {
  const all = [...upcoming, ...previous];
  if (!all.length) return '';
  const venues = new Set(all.map((e) => (e.location || '').split(',')[0].trim().toLowerCase()).filter(Boolean));
  const firstYear = all.map((e) => e.date.slice(0, 4)).sort()[0];
  const parts = [
    `${previous.length} night${previous.length === 1 ? '' : 's'} so far`,
    `${venues.size} venue${venues.size === 1 ? '' : 's'}`,
    `since ${firstYear}`,
  ];
  if (upcoming.length) parts.unshift(`${upcoming.length} coming up`);
  return parts.join(' &middot; ');
}

// ── About page ───────────────────────────────────────────────────────

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

// Blank lines split paragraphs; single line breaks stay as line breaks
function aboutIntro() {
  return about.intro
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

function personPhoto(person, cls) {
  if (person.photo) {
    return `<div class="${cls}"><img src="assets/about/${person.photo}" alt="${escapeHtml(person.name)}" loading="lazy"${photoCropStyle(person.crop)}></div>`;
  }
  return `<div class="${cls} ${cls}--empty"><span class="about-initials">${escapeHtml(initials(person.name))}</span>` +
    '<span class="about-placeholder">Photo coming soon</span></div>';
}

function residentCard(artist) {
  const meta = [artist.genre, artist.from].filter(Boolean).map(escapeHtml).join(' &middot; ');
  const body = [
    artist.role && `<p class="resident__role">${escapeHtml(artist.role)}</p>`,
    `<h3 class="resident__name">${escapeHtml(artist.name)}</h3>`,
    meta && `<p class="resident__meta">${meta}</p>`,
    artist.bio && `<p class="resident__bio">${escapeHtml(artist.bio)}</p>`,
  ].filter(Boolean);
  return `<article class="resident" id="artist-${artistSlug(artist.name)}">
        ${personPhoto(artist, 'resident__photo')}
        <div class="resident__body">
          ${body.join('\n          ')}
        </div>
      </article>`;
}

// The people behind Anima — a wide feature under the intro (nothing if no name is set)
function foundersFeature() {
  const f = about.founders;
  if (!f.name) return '';
  const body = [
    f.role && `<p class="section-label">${escapeHtml(f.role)}</p>`,
    `<h2 class="founders__name">${escapeHtml(f.name)}</h2>`,
    f.members && `<p class="founders__members">${escapeHtml(f.members)}</p>`,
    f.genre && `<p class="resident__meta">${escapeHtml(f.genre)}</p>`,
    f.bio && `<p class="founders__bio">${escapeHtml(f.bio)}</p>`,
  ].filter(Boolean);
  return `<div class="founders" id="artist-${artistSlug(f.name)}">
      ${personPhoto(f, 'founders__photo')}
      <div class="founders__body">
        ${body.join('\n        ')}
      </div>
    </div>`;
}

function residentCards() {
  return about.artists.length
    ? about.artists.map(residentCard).join('\n')
    : '<p class="events-empty">Resident artists announced soon.</p>';
}

// Everyone in the event lineups: slug → { name, photo (latest lineup headshot), nights: [events] }
function lineupArtists(manifest) {
  const artists = new Map();
  for (const event of [...manifest.upcoming, ...manifest.previous]) {
    for (const entry of event.lineup || []) {
      const names = artistNames(entry.name);
      for (const name of names) {
        const slug = artistSlug(name);
        if (!slug) continue;
        const artist = artists.get(slug) || { name, photo: null, crop: null, nights: [] };
        if (!artist.photo && entry.photo && names.length === 1) {
          artist.photo = entry.photo;
          artist.crop = entry.photoCrop || null;
        }
        if (!artist.nights.includes(event)) artist.nights.push(event);
        artists.set(slug, artist);
      }
    }
  }
  return artists;
}

// Guest DJs from the About tab, plus anyone in a lineup who isn't on the About page yet — so every
// lineup link (event-card.js artistHref) has somewhere to land. Most nights first.
function guestDjs(manifest) {
  const listed = new Set([about.founders.name, ...about.artists.map((a) => a.name)].filter(Boolean).map(artistSlug));
  const lineups = lineupArtists(manifest);
  const guests = new Map();
  const add = (slug, name, info = {}) => {
    const found = lineups.get(slug) || { photo: null, nights: [] };
    guests.set(slug, {
      name, slug, label: 'Guest DJ', genre: info.genre || '', from: info.from || '', bio: info.bio || '',
      photo: info.photo ? `assets/about/${info.photo}` : found.photo,
      crop: info.photo ? info.crop : found.crop, nights: found.nights,
    });
  };
  for (const guest of about.guests) {
    const slug = artistSlug(guest.name);
    if (slug && !listed.has(slug)) add(slug, guest.name, guest);
  }
  for (const [slug, found] of lineups) {
    if (!listed.has(slug) && !guests.has(slug)) add(slug, found.name);
  }
  return [...guests.values()].sort((a, b) => b.nights.length - a.nights.length || a.name.localeCompare(b.name));
}

// Founders, residents and guests in one shape, for the tiles
function allArtists(manifest) {
  const lineups = lineupArtists(manifest);
  const known = (person, label, extra = {}) => {
    const slug = artistSlug(person.name);
    const found = lineups.get(slug) || { photo: null, crop: null, nights: [] };
    return {
      name: person.name, slug, label, genre: person.genre, from: person.from || '', bio: person.bio,
      photo: person.photo ? `assets/about/${person.photo}` : found.photo,
      crop: person.photo ? person.crop : found.crop, nights: found.nights, ...extra,
    };
  };
  return [
    ...(about.founders.name ? [known(about.founders, about.founders.role || 'Founders', { members: about.founders.members })] : []),
    ...about.artists.map((a) => known(a, a.role || 'Resident')),
    ...guestDjs(manifest),
  ];
}

function shortEventName(event) {
  return escapeHtml(event.name.replace(/^Avec Anima:\s*/i, ''));
}

function nightsLabel(guest) {
  return `${guest.nights.length} night${guest.nights.length === 1 ? '' : 's'}`;
}

// The tile that opens when an artist is clicked (js/artist-tile.js) — photo, details, nights played
function artistTile(artist) {
  const name = escapeHtml(artist.name);
  const meta = [artist.genre, artist.from].filter(Boolean).map(escapeHtml).join(' &middot; ');
  const photo = artist.photo
    ? `<div class="guest-detail__photo"><img src="${artist.photo}" alt="${name}"${photoCropStyle(artist.crop)}></div>`
    : `<div class="guest-detail__photo guest-detail__photo--empty"><span class="about-initials">${escapeHtml(initials(artist.name))}</span>` +
      '<span class="about-placeholder">Photo coming soon</span></div>';
  const nights = artist.nights.map((e) => `<li><a href="${e.page}">${shortEventName(e)}</a><span>${formatDate(e.date).replace(/^\w+, /, '')}</span></li>`).join('');
  const body = [
    `<p class="section-label">${escapeHtml(artist.label)}</p>`,
    `<h3 class="guest-detail__name">${name}</h3>`,
    artist.members && `<p class="founders__members">${escapeHtml(artist.members)}</p>`,
    meta && `<p class="resident__meta">${meta}</p>`,
    artist.bio && `<p class="guest-detail__bio">${escapeHtml(artist.bio)}</p>`,
    artist.nights.length && `<p class="guest-detail__label">Played Anima &middot; ${nightsLabel(artist)}</p>`,
    artist.nights.length && `<ul class="guest-detail__nights">${nights}</ul>`,
    `<a class="guest-detail__more" href="about.html#artist-${artist.slug}">More on the About page &rarr;</a>`,
  ].filter(Boolean);
  return `${photo}<div class="guest-detail__body">${body.join('')}</div>`;
}

// assets/about/artists.json — every artist's tile, keyed by slug, for js/artist-tile.js
function writeArtistTiles(manifest) {
  const tiles = {};
  for (const artist of allArtists(manifest)) tiles[artist.slug] = artistTile(artist);
  fs.mkdirSync(path.join(WEBSITE_DIR, 'assets', 'about'), { recursive: true });
  fs.writeFileSync(path.join(WEBSITE_DIR, 'assets', 'about', 'artists.json'), JSON.stringify(tiles));
}

// Clicking a card opens that guest's tile (js/artist-tile.js)
function guestCard(guest) {
  const name = escapeHtml(guest.name);
  const avatar = guest.photo
    ? `<img src="${guest.photo}" alt="" loading="lazy"${photoCropStyle(guest.crop)}>`
    : `<span>${escapeHtml(initials(guest.name))}</span>`;
  const meta = [guest.genre, guest.from].filter(Boolean).map(escapeHtml).join(' &middot; ');
  return `<article class="guest" id="artist-${guest.slug}">
        <button type="button" class="guest__open" data-artist="${guest.slug}" aria-haspopup="dialog">
          <span class="guest__avatar">${avatar}</span>
          <span class="guest__text">
            <span class="guest__name">${name}</span>
            <span class="guest__nights">${meta || (guest.nights.length ? nightsLabel(guest) : 'Guest DJ')}</span>
          </span>
        </button>
      </article>`;
}

function guestsSection(manifest) {
  const guests = guestDjs(manifest);
  if (!guests.length) return '';
  return `<section class="section container about-guests">
    <div class="section-header section-header--center">
      <div>
        <p class="section-label">Played Anima</p>
        <h2 class="section-title section-title--md">Guest DJs</h2>
        ${about.guestsIntro ? `<p class="about-guests__intro">${escapeHtml(about.guestsIntro)}</p>` : ''}
      </div>
    </div>
    <div class="guests">
      ${guests.map(guestCard).join('\n      ')}
    </div>
  </section>`;
}

function aboutSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'AboutPage',
    url: absoluteUrl('about.html'),
    about: { '@id': `${site.siteUrl}/#organization` },
    mentions: [...(about.founders.name ? [{
      '@type': 'MusicGroup',
      name: about.founders.name,
      description: [about.founders.role, about.founders.members].filter(Boolean).join(' — ') || undefined,
      image: about.founders.photo ? absoluteUrl(`assets/about/${about.founders.photo}`) : undefined,
    }] : []), ...about.artists.map((a) => ({
      '@type': 'Person',
      name: a.name,
      jobTitle: a.role ? `DJ, ${a.role}` : 'DJ',
      image: a.photo ? absoluteUrl(`assets/about/${a.photo}`) : undefined,
      description: a.bio || undefined,
    })), ...guestDjs(lastManifest).filter((g) => g.bio || g.genre).map((g) => ({
      '@type': 'Person',
      name: g.name,
      jobTitle: 'DJ',
      image: g.photo ? absoluteUrl(g.photo) : undefined,
      description: [g.genre, g.bio].filter(Boolean).join(' — '),
    }))],
  };
}

function eventCards(events, isPrevious, emptyText) {
  return events.length
    ? events.map((e) => renderEventCard(e, isPrevious).trim()).join('\n')
    : `<p class="events-empty">${emptyText}</p>`;
}

function writeStaticPages(manifest) {
  const { upcoming, previous } = manifest;
  const image = absoluteUrl(DEFAULT_IMAGE);

  for (const [file, page] of Object.entries(PAGES)) {
    const filePath = path.join(WEBSITE_DIR, file);
    if (!fs.existsSync(filePath)) continue;
    let html = fs.readFileSync(filePath, 'utf8');

    const schema = file === 'index.html' ? [organizationSchema(), websiteSchema()] : [];
    if (file === 'events.html') {
      schema.push(...upcoming.map((e) => eventSchema(e, false)));
    }
    if (file === 'about.html') schema.push(aboutSchema());
    if (file === 'gallery.html') {
      schema.push(...eventsWithMedia(manifest).filter((e) => e.aftermovie).map(videoSchema));
    }

    html = fillSeoBlock(html, headTags({
      title: (site.seo[file] || page).title,
      description: (site.seo[file] || page).description,
      url: absoluteUrl(page.path),
      image,
      indexable: page.sitemap !== false,
      schema,
    }), file);

    if (file === 'index.html') {
      html = fillPrerender(html, 'home-upcoming-events',
        upcoming.length ? renderHomeUpcoming(upcoming).trim() : renderUpcomingEmpty(site.instagramUrl), file);
    }
    if (file === 'gallery.html') {
      const withMedia = eventsWithMedia(manifest);
      html = fillPrerender(html, 'gallery-root', renderGallery(manifest), file);
      html = fillPrerender(html, 'page-hero-strip',
        heroStrip(withMedia.map((e) => e.aftermoviePoster || (e.gallery[0] && e.gallery[0].thumb) || e.poster)), file);
      html = fillPrerender(html, 'page-hero-stats', galleryStats(withMedia), file);
      html = fillPrerender(html, 'page-hero-chips', withMedia
        .map((e) => `<a href="#${e.slug}">${escapeHtml(e.name.replace(/^Avec Anima:\s*/i, ''))}</a>`)
        .join(''), file);
    }
    if (file === 'music.html') {
      html = fillPrerender(html, 'page-hero-strip', heroStrip(musicHeroImages(manifest)), file);
    }
    if (file === 'about.html') {
      const photos = eventsWithMedia(manifest).flatMap((e) => (e.gallery || []).slice(0, 2).map((p) => p.thumb));
      html = fillPrerender(html, 'page-hero-strip', heroStrip(photos), file);
      html = fillPrerender(html, 'about-intro', aboutIntro(), file);
      html = fillPrerender(html, 'about-founders', foundersFeature(), file);
      html = fillPrerender(html, 'about-artists', residentCards(), file);
      html = fillPrerender(html, 'about-guests', guestsSection(manifest), file);
    }
    if (file === 'events.html') {
      html = fillPrerender(html, 'upcoming-events',
        upcoming.length ? eventCards(upcoming, false) : renderUpcomingEmpty(site.instagramUrl), file);
      html = fillPrerender(html, 'page-hero-strip', heroStrip([...upcoming, ...previous].map((e) => e.poster)), file);
      html = fillPrerender(html, 'page-hero-stats', eventsStats(manifest), file);
      html = fillPrerender(html, 'previous-events', eventCards(previous, true, 'Nothing here yet.'), file);
    }

    fs.writeFileSync(filePath, versionAssets(applySiteSettings(html, site)));
  }

  // Admin has no SEO block but shares the nav/footer links
  const adminPath = path.join(WEBSITE_DIR, 'admin.html');
  if (fs.existsSync(adminPath)) {
    fs.writeFileSync(adminPath, versionAssets(applySiteSettings(fs.readFileSync(adminPath, 'utf8'), site)));
  }
}

function eventDescription(event) {
  if (event.description) return truncate(event.description, 160);
  const lineup = (event.lineup || []).map((a) => a.name).join(', ');
  return truncate(
    `${event.name} — ${formatDate(event.date)} at ${event.location}.${lineup ? ` Lineup: ${lineup}.` : ''}`,
    160
  );
}

// Built from event.html so nav/footer changes carry over automatically
function writeEventPages(manifest) {
  const template = fs.readFileSync(path.join(WEBSITE_DIR, 'event.html'), 'utf8');

  fs.mkdirSync(EVENT_PAGES_DIR, { recursive: true });
  for (const file of fs.readdirSync(EVENT_PAGES_DIR)) {
    if (file.endsWith('.html')) fs.unlinkSync(path.join(EVENT_PAGES_DIR, file));
  }

  const all = [
    ...manifest.upcoming.map((e) => [e, false]),
    ...manifest.previous.map((e) => [e, true]),
  ];

  for (const [event, isPrevious] of all) {
    const tags = headTags({
      title: event.name.includes(SITE_NAME)
        ? `${event.name} — ${formatDate(event.date)}`
        : `${event.name} — ${formatDate(event.date)} | ${SITE_NAME}`,
      description: eventDescription(event),
      url: absoluteUrl(event.page),
      image: absoluteUrl(event.poster),
      schema: [eventSchema(event, isPrevious)],
    });

    let html = fillSeoBlock(template, tags, `events/${event.slug}`);
    // Pages live one folder down — resolve every relative link from the site root
    html = html.replace('<head>', '<head>\n  <base href="../">');
    html = html.replace(
      /(<main[^>]*id="event-root"[^>]*>)[\s\S]*?(<\/main>)/,
      `$1\n${renderEventDetail(event, isPrevious)}\n  $2`
    );
    html = html.replace(/\s*<script src="js\/event-detail\.js(\?v=\w*)?"><\/script>/, '');
    html = html.replace(/\s*<script src="js\/event-card\.js(\?v=\w*)?"><\/script>/, '');

    fs.writeFileSync(path.join(WEBSITE_DIR, event.page), versionAssets(html));
  }
}

function writeSitemap(manifest) {
  const urls = [
    ...Object.values(PAGES).filter((p) => p.sitemap !== false).map((p) => absoluteUrl(p.path)),
    ...manifest.upcoming.map((e) => absoluteUrl(e.page)),
    ...manifest.previous.map((e) => absoluteUrl(e.page)),
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls.map((u) => `  <url><loc>${escapeHtml(u)}</loc></url>`),
    '</urlset>',
    '',
  ].join('\n');

  fs.writeFileSync(path.join(WEBSITE_DIR, 'sitemap.xml'), xml);
}

// robots.txt — everything may be crawled; points search engines at the sitemap
function writeRobotsTxt() {
  fs.writeFileSync(path.join(WEBSITE_DIR, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl('sitemap.xml')}\n`);
}

// llms.txt — plain-text summary for AI assistants (https://llmstxt.org)
function writeLlmsTxt(manifest) {
  const guests = guestDjs(manifest);
  const eventLine = (e) => {
    const lineup = (e.lineup || []).map((a) => a.name).join(', ');
    const tickets = hasTicketLink(e) ? ` Tickets: ${e.ticketLink}` : '';
    const media = [
      e.aftermovie ? `after movie: ${absoluteUrl(e.aftermovie)}` : '',
      e.gallery && e.gallery.length ? `${e.gallery.length} photos: ${absoluteUrl('gallery.html')}#${e.slug}` : '',
    ].filter(Boolean).join('; ');
    return `- [${e.name}](${absoluteUrl(e.page)}): ${formatDate(e.date)}, ${e.startTime}–${e.endTime}, ${e.location}.` +
      `${lineup ? ` Lineup: ${lineup}.` : ''}${tickets}${media ? ` Media — ${media}.` : ''}`;
  };

  const text = [
    `# ${SITE_NAME}`,
    '',
    `> ${site.about}`,
    '',
    ...[
      site.contactEmail && `Contact: ${site.contactEmail}`,
      site.instagramUrl && `Instagram: ${site.instagramUrl}`,
      site.facebookUrl && `Facebook: ${site.facebookUrl}`,
      site.youtubeChannelUrl && `YouTube: ${site.youtubeChannelUrl}`,
      site.soundcloudProfileUrl && `SoundCloud: ${site.soundcloudProfileUrl}`,
      site.storeUrl && `Store: ${site.storeUrl}`,
    ].filter(Boolean),
    '',
    '## Pages',
    '',
    `- [Home](${absoluteUrl('')}): Next upcoming events, featured live set and merch`,
    `- [Events](${absoluteUrl('events.html')}): Full list of upcoming and previous events`,
    `- [Gallery & After Movies](${absoluteUrl('gallery.html')}): After movies and photo galleries from past events`,
    `- [Music](${absoluteUrl('music.html')}): Live sets on YouTube and playlists curated by the Avec Anima selectors on SoundCloud`,
    `- [About](${absoluteUrl('about.html')}): What Avec Anima is about, and its resident artists`,
    '',
    ...(about.founders.name ? [
      '## Founders',
      '',
      `- ${about.founders.name}${about.founders.members ? ` (${about.founders.members})` : ''}` +
        `${about.founders.role ? ` — ${about.founders.role}` : ''}${about.founders.bio ? `: ${about.founders.bio}` : ''}`,
      '',
    ] : []),
    ...(about.artists.length ? [
      '## Resident artists',
      '',
      ...about.artists.map((a) => {
        const meta = [a.genre, a.from && `from ${a.from}`].filter(Boolean).join(', ');
        return `- ${a.name}${a.role ? ` — ${a.role}` : ''}${meta ? ` (${meta})` : ''}${a.bio ? `: ${a.bio}` : ''}`;
      }),
      '',
    ] : []),
    ...(guests.length ? [
      '## Guest DJs',
      '',
      ...guests.map((g) => {
        const meta = [g.genre, g.from && `from ${g.from}`].filter(Boolean).join(', ');
        return `- ${g.name}${meta ? ` (${meta})` : ''}${g.bio ? `: ${g.bio}` : ''}${g.nights.length ? ` — played ${nightsLabel(g)}` : ''}`;
      }),
      '',
    ] : []),
    '## Upcoming events',
    '',
    ...(manifest.upcoming.length ? manifest.upcoming.map(eventLine) : ['- None announced yet — check the events page.']),
    '',
    '## Previous events',
    '',
    ...manifest.previous.map(eventLine),
    '',
  ].join('\n');

  fs.writeFileSync(path.join(WEBSITE_DIR, 'llms.txt'), text);
}

function writeSeoFiles(manifest) {
  assetHashes.clear(); // re-hash in case a stylesheet or script changed since the last build
  site = readSite();
  about = readAbout();
  lastManifest = manifest;
  writeArtistTiles(manifest);
  writeStaticPages(manifest);
  writeEventPages(manifest);
  writeSitemap(manifest);
  writeRobotsTxt();
  writeLlmsTxt(manifest);
}

module.exports = { writeSeoFiles };
