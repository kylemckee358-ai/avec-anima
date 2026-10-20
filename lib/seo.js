// Search engine + AI crawler support for the static site.
// Runs after every manifest rebuild (see writeManifest in events-data.js) and:
//   - fills the <!-- seo --> block in each page's <head> (title, description, canonical, social cards, schema)
//   - pre-renders event cards into index.html / events.html so crawlers see them without JavaScript
//   - writes a static page per event to website/events/<slug>.html
//   - writes sitemap.xml and llms.txt
//   - applies site settings (links + editable text, see lib/site.js) to every page
//
// Moving to a custom domain? Change "Site address" in admin → Site Settings.

const fs = require('fs');
const path = require('path');
const { renderEventCard } = require('../website/js/event-card');
const { renderEventDetail } = require('../website/js/event-detail');
const { renderGallery, eventsWithMedia } = require('../website/js/gallery');
const { readSite, applySiteSettings } = require('./site');

const SITE_NAME = 'Avec Anima';
const DEFAULT_IMAGE = 'assets/og-image.jpg';
const WEBSITE_DIR = path.join(__dirname, '..', 'website');
const EVENT_PAGES_DIR = path.join(WEBSITE_DIR, 'events');

// Settings for the current build — loaded fresh by writeSeoFiles() each time
let site = readSite();

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

function fillSeoBlock(html, tags, file) {
  return replaceBlock(html, '<!-- seo -->', '<!-- /seo -->', `\n  ${tags}\n  `, file);
}

function fillPrerender(html, id, content, file) {
  return replaceBlock(html, `<!-- prerender:${id} -->`, '<!-- /prerender -->', `\n      ${content.trim()}\n      `, file);
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
        eventCards(upcoming.slice(0, 3), false, 'No upcoming events right now — check back soon.'), file);
    }
    if (file === 'gallery.html') {
      html = fillPrerender(html, 'gallery-root', renderGallery(manifest), file);
    }
    if (file === 'events.html') {
      html = fillPrerender(html, 'upcoming-events',
        eventCards(upcoming, false, 'No upcoming events right now — check back soon.'), file);
      html = fillPrerender(html, 'previous-events', eventCards(previous, true, 'Nothing here yet.'), file);
    }

    fs.writeFileSync(filePath, applySiteSettings(html, site));
  }

  // Admin has no SEO block but shares the nav/footer links
  const adminPath = path.join(WEBSITE_DIR, 'admin.html');
  if (fs.existsSync(adminPath)) {
    fs.writeFileSync(adminPath, applySiteSettings(fs.readFileSync(adminPath, 'utf8'), site));
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
    html = html.replace(/\s*<script src="js\/event-detail\.js"><\/script>/, '');
    html = html.replace(/\s*<script src="js\/event-card\.js"><\/script>/, '');

    fs.writeFileSync(path.join(WEBSITE_DIR, event.page), html);
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

// llms.txt — plain-text summary for AI assistants (https://llmstxt.org)
function writeLlmsTxt(manifest) {
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
    `- [Music](${absoluteUrl('music.html')}): Live sets on YouTube and mixes on SoundCloud`,
    '',
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
  site = readSite();
  writeStaticPages(manifest);
  writeEventPages(manifest);
  writeSitemap(manifest);
  writeLlmsTxt(manifest);
}

module.exports = { writeSeoFiles };
