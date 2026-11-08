// Event detail page — reads ?category=&slug= from the URL and renders a single event

function formatFullDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

// Artist name helpers live in event-card.js (loaded first in the browser, required in Node)
const artistHelpers = typeof module !== 'undefined' ? require('./event-card') : window;

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

// Links to the artist on the About page — the whole pill, or each name for a b2b
function renderLineupItem(artist) {
  const { name, note } = artistHelpers.splitArtistName(artist.name);
  const names = artistHelpers.artistNames(artist.name);
  const linkWhole = names.length === 1;
  const avatar = artist.photo
    ? `<img src="${artist.photo}" alt="${name}" loading="lazy"${artistHelpers.photoCropStyle(artist.photoCrop)}>`
    : `<span>${initials(name)}</span>`;

  const inner = `
      <span class="lineup-item__avatar">${avatar}</span>
      <span class="lineup-item__text">
        <span class="lineup-item__name">${linkWhole ? name : artistHelpers.linkedArtistNames(artist.name)}</span>
        ${note ? `<span class="lineup-item__note">${note}</span>` : ''}
      </span>
  `;
  return linkWhole
    ? `<li><a class="lineup-item lineup-item--link" href="${artistHelpers.artistHref(name)}">${inner}</a></li>`
    : `<li class="lineup-item">${inner}</li>`;
}

// Poster on the left; everything else (name, details, lineup) in one column beside it.
// opts.heading — tag for the event name (the home page already has its own h1)
// opts.label — false hides the "Upcoming" label when the section title already says it
function renderEventDetail(event, isPrevious, opts = {}) {
  const heading = opts.heading || 'h1';
  const cta = isPrevious
    ? `<span class="btn btn--muted">Past Event</span>`
    : `<a href="${event.ticketLink}" target="_blank" rel="noopener" class="btn btn--solid">Buy Tickets</a>`;

  const hasMedia = event.aftermovie || (event.gallery && event.gallery.length);
  const mediaLink = hasMedia
    ? `<a href="gallery.html#${encodeURIComponent(event.slug)}" class="btn btn--outline">${event.aftermovie ? 'Photos &amp; After Movie' : 'Photos'}</a>`
    : '';
  const lineup = event.lineup || [];
  const time = event.startTime ? `${event.startTime}${event.endTime ? `&ndash;${event.endTime}` : ''}` : 'TBA';

  return `
    <div class="event-detail${isPrevious ? ' event-detail--previous' : ''}">
      <div class="event-detail__poster">
        <img src="${event.poster}" alt="${event.name} poster">
      </div>

      <div class="event-detail__info">
        ${opts.label === false ? '' : `<p class="section-label">${isPrevious ? 'Past Event' : 'Upcoming'}</p>`}
        <${heading} class="event-detail__name">${event.name}</${heading}>
        ${event.description ? `<p class="event-detail__description">${event.description}</p>` : ''}

        <div class="event-detail__card">
          <div class="detail-field">
            <span class="detail-field__label">Date</span>
            <span class="detail-field__value">${formatFullDate(event.date)}</span>
          </div>
          <div class="detail-field">
            <span class="detail-field__label">Time</span>
            <span class="detail-field__value">${time}</span>
          </div>
          <div class="detail-field detail-field--wide">
            <span class="detail-field__label">Location</span>
            <span class="detail-field__value">${event.location}</span>
          </div>
          <div class="event-detail__actions">
            ${cta}
            ${mediaLink}
          </div>
        </div>

        ${lineup.length ? `
          <div class="event-detail__lineup">
            <p class="detail-field__label">Lineup</p>
            <ul class="lineup-list">${lineup.map(renderLineupItem).join('')}</ul>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// Home page: the next event shown in full, any others after it as cards
function renderHomeUpcoming(upcoming) {
  const [next, ...more] = upcoming;
  const cards = typeof renderEventCard === 'function' ? renderEventCard : artistHelpers.renderEventCard;
  return `
    <div class="home-next-event">${renderEventDetail(next, false, { heading: 'h3', label: false })}</div>
    ${more.length ? `
      <p class="section-label home-more-label">Also Coming Up</p>
      <div class="event-grid">${more.slice(0, 3).map((e) => cards(e, false)).join('')}</div>
    ` : ''}
  `;
}

const eventRoot = typeof document !== 'undefined' && document.getElementById('event-root');
if (eventRoot) (async function () {
  const root = eventRoot;
  const params = new URLSearchParams(window.location.search);
  const requestedCategory = params.get('category');
  const slug = params.get('slug');

  try {
    const manifest = await loadEventsManifest();

    let event = null;
    let isPrevious = false;

    if (requestedCategory === 'previous') {
      event = manifest.previous.find((e) => e.slug === slug);
      isPrevious = true;
    } else if (requestedCategory === 'upcoming') {
      event = manifest.upcoming.find((e) => e.slug === slug);
    }

    if (!event) {
      event = manifest.upcoming.find((e) => e.slug === slug);
      isPrevious = false;
    }
    if (!event) {
      event = manifest.previous.find((e) => e.slug === slug);
      isPrevious = true;
    }

    if (!event) {
      root.innerHTML = '<p class="events-empty">Event not found. <a href="events.html" style="text-decoration: underline;">Back to all events</a>.</p>';
      return;
    }

    // Every event has a pre-rendered page — send old event.html links there
    if (event.page) {
      window.location.replace(event.page);
      return;
    }

    document.title = `${event.name} — Avec Anima`;
    root.innerHTML = renderEventDetail(event, isPrevious);
  } catch (err) {
    root.innerHTML = '<p class="events-empty">Couldn\'t load this event. Refresh to try again.</p>';
    console.error(err);
  }
})();

// Lets lib/seo.js reuse the detail renderer when pre-rendering event pages in Node
if (typeof module !== 'undefined') {
  module.exports = { renderEventDetail, renderHomeUpcoming };
}
