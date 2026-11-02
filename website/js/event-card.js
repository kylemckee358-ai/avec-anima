// Shared event card renderer used by main.js (home) and events.js (events page)

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateBadge(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return { month: MONTHS[month - 1], day };
}

function formatDateMeta(dateStr, startTime, endTime) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  return `${weekday}, ${day} ${MONTHS[month - 1]} ${year} &middot; ${startTime}&ndash;${endTime}`;
}

// ── Artist links ─────────────────────────────────────────────────────
// Every lineup name links to that artist on the About page (about.html#artist-<slug>) — founders,
// residents, and everyone else under Guest DJs (lib/seo.js builds that list from the lineups).

// "John Bolton (Vinyl Set)" → name "John Bolton", note "Vinyl Set"
function splitArtistName(full) {
  const match = full.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  return match ? { name: match[1], note: match[2] } : { name: full, note: '' };
}

// "Paz b2b Jaime Craig" → ['Paz', 'Jaime Craig']
function artistNames(full) {
  return splitArtistName(full).name.split(/\s+b2b\s+/i).map((n) => n.trim()).filter(Boolean);
}

function artistSlug(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function artistHref(name) {
  return `about.html#artist-${artistSlug(name)}`;
}

// Each name in a lineup entry as a link ("Paz b2b Jaime Craig" → two links)
function linkedArtistNames(full) {
  return artistNames(full).map((n) => `<a class="artist-link" href="${artistHref(n)}">${n}</a>`).join(' b2b ');
}

function renderEventCard(event, isPrevious) {
  const badge = formatDateBadge(event.date);
  const category = isPrevious ? 'previous' : 'upcoming';
  const detailHref = event.page || `event.html?category=${category}&slug=${encodeURIComponent(event.slug)}`;
  const actions = isPrevious
    ? `<a href="${detailHref}" class="btn btn--muted">Past Event</a>`
    : `
      <a href="${event.ticketLink}" target="_blank" rel="noopener" class="btn btn--solid">Get Tickets</a>
      <a href="${detailHref}" class="btn btn--outline">Details</a>
    `;
  // Outside the card's main link — the names link to the About page
  const lineup = event.lineup && event.lineup.length
    ? `<p class="event-card__lineup"><span class="event-card__lineup-label">Lineup</span>${event.lineup.map((a) => {
      const { note } = splitArtistName(a.name);
      return linkedArtistNames(a.name) + (note ? ` (${note})` : '');
    }).join(', ')}</p>`
    : '';

  return `
    <div class="event-card${isPrevious ? ' event-card--previous' : ''}">
      <a class="event-card__link" href="${detailHref}">
        <div class="event-card__poster">
          <img src="${event.poster}" alt="${event.name} poster" loading="lazy">
          <div class="date-badge">
            <span class="date-badge__month">${badge.month}</span>
            <span class="date-badge__day">${badge.day}</span>
          </div>
        </div>
        <div class="event-card__body">
          <h3 class="event-card__name">${event.name}</h3>
          <p class="event-card__meta">${formatDateMeta(event.date, event.startTime, event.endTime)}</p>
          <p class="event-card__meta">${event.location}</p>
        </div>
      </a>
      ${lineup}
      <div class="event-card__actions">${actions}</div>
    </div>
  `;
}

// Shown in place of upcoming cards when nothing is announced (events page + home page).
// instagramUrl comes from site settings: lib/seo.js passes it at build time, the browser
// reads it from the footer link the build wrote.
function renderUpcomingEmpty(instagramUrl) {
  if (instagramUrl === undefined && typeof document !== 'undefined') {
    const link = document.querySelector('[data-site-href="instagramUrl"]:not([hidden])');
    instagramUrl = link ? link.getAttribute('href') : '';
  }

  return `
    <div class="next-night">
      <div class="next-night__poster" aria-hidden="true">
        <img src="assets/logo.png" alt="">
        <span>TBA</span>
      </div>
      <div class="next-night__body">
        <p class="section-label">Next Night</p>
        <h3 class="next-night__title">To Be Announced</h3>
        <p class="next-night__text">The next Avec Anima night lands on Instagram first &mdash; date, venue, lineup and tickets.</p>
        <div class="next-night__actions">
          ${instagramUrl ? `<a href="${instagramUrl}" target="_blank" rel="noopener" class="btn btn--solid">Follow on Instagram</a>` : ''}
          <a href="gallery.html" class="btn btn--outline">Watch the After Movies</a>
        </div>
      </div>
    </div>
  `;
}

async function loadEventsManifest() {
  const res = await fetch('assets/events/manifest.json');
  if (!res.ok) throw new Error('Failed to load events manifest');
  return res.json();
}

// Lets lib/seo.js reuse the card renderer when pre-rendering pages in Node
if (typeof module !== 'undefined') {
  module.exports = { renderEventCard, renderUpcomingEmpty, splitArtistName, artistNames, artistSlug, artistHref, linkedArtistNames };
}
