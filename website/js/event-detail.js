// Event detail page — reads ?category=&slug= from the URL and renders a single event

function formatFullDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

// "John Bolton (Vinyl Set)" → name "John Bolton", note "Vinyl Set"
function splitArtistName(full) {
  const match = full.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  return match ? { name: match[1], note: match[2] } : { name: full, note: '' };
}

function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

function renderLineupItem(artist) {
  const { name, note } = splitArtistName(artist.name);
  const avatar = artist.photo
    ? `<img src="${artist.photo}" alt="${name}" loading="lazy">`
    : `<span>${initials(name)}</span>`;

  return `
    <li class="lineup-item">
      <span class="lineup-item__avatar">${avatar}</span>
      <span class="lineup-item__text">
        <span class="lineup-item__name">${name}</span>
        ${note ? `<span class="lineup-item__note">${note}</span>` : ''}
      </span>
    </li>
  `;
}

// Poster on the left; everything else (name, details, lineup) in one column beside it
function renderEventDetail(event, isPrevious) {
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
        <p class="section-label">${isPrevious ? 'Past Event' : 'Upcoming'}</p>
        <h1 class="event-detail__name">${event.name}</h1>
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

if (typeof document !== 'undefined') (async function () {
  const root = document.getElementById('event-root');
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
  module.exports = { renderEventDetail };
}
