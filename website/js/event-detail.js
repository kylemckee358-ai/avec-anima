// Event detail page — reads ?category=&slug= from the URL and renders a single event

function formatFullDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function renderArtistCard(artist) {
  const photo = artist.photo
    ? `<img src="${artist.photo}" alt="${artist.name}" loading="lazy">`
    : `<span class="artist-card__na">N/A</span>`;

  return `
    <div class="artist-card">
      <div class="artist-card__photo">${photo}</div>
      <p class="artist-card__name">${artist.name}</p>
    </div>
  `;
}

function renderEventDetail(event, isPrevious) {
  const cta = isPrevious
    ? `<span class="btn btn--muted">Past Event</span>`
    : `<a href="${event.ticketLink}" target="_blank" rel="noopener" class="btn btn--solid">Buy Tickets</a>`;

  const lineupCards = (event.lineup || []).map(renderArtistCard).join('');
  const venueName = event.location.split(',')[0];

  return `
    <div class="event-detail${isPrevious ? ' event-detail--previous' : ''}">
      <div>
        <div class="event-detail__poster">
          <img src="${event.poster}" alt="${event.name}">
        </div>
        <div class="event-detail__main">
          <h1 class="event-detail__name">${event.name}</h1>
          ${event.description ? `<p class="event-detail__description">${event.description}</p>` : ''}
        </div>
      </div>
      <aside class="event-detail__sidebar">
        ${cta}
        <div class="detail-field">
          <span class="detail-field__label">Date</span>
          <span class="detail-field__value">${formatFullDate(event.date)}</span>
        </div>
        <div class="detail-field">
          <span class="detail-field__label">Time</span>
          <span class="detail-field__value">${event.startTime}&ndash;${event.endTime}</span>
        </div>
        <div class="detail-field">
          <span class="detail-field__label">Location</span>
          <span class="detail-field__value">${event.location}</span>
        </div>
      </aside>
    </div>

    ${lineupCards ? `
      <div class="mt-section">
        <div class="section-header">
          <h2 class="section-title" style="font-size: clamp(24px, 3vw, 32px);">Lineup</h2>
        </div>
        <div class="artist-grid">${lineupCards}</div>
      </div>
    ` : ''}

    <div class="mt-section">
      <div class="section-header">
        <h2 class="section-title" style="font-size: clamp(24px, 3vw, 32px);">Venue</h2>
      </div>
      <div class="venue-block">
        <span class="venue-block__name">${venueName}</span>
      </div>
    </div>
  `;
}

(async function () {
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

    document.title = `${event.name} — Avec Anima`;
    root.innerHTML = renderEventDetail(event, isPrevious);
  } catch (err) {
    root.innerHTML = '<p class="events-empty">Couldn\'t load this event. Refresh to try again.</p>';
    console.error(err);
  }
})();
