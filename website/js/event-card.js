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

function renderEventCard(event, isPrevious) {
  const badge = formatDateBadge(event.date);
  const category = isPrevious ? 'previous' : 'upcoming';
  const detailHref = `event.html?category=${category}&slug=${encodeURIComponent(event.slug)}`;
  const actions = isPrevious
    ? `<a href="${detailHref}" class="btn btn--muted">Past Event</a>`
    : `
      <a href="${event.ticketLink}" target="_blank" rel="noopener" class="btn btn--solid">Get Tickets</a>
      <a href="${detailHref}" class="btn btn--outline">Details</a>
    `;
  const lineup = event.lineup && event.lineup.length
    ? `<p class="event-card__lineup"><span class="event-card__lineup-label">Lineup</span>${event.lineup.map((a) => a.name).join(', ')}</p>`
    : '';

  return `
    <div class="event-card${isPrevious ? ' event-card--previous' : ''}">
      <a class="event-card__link" href="${detailHref}">
        <div class="event-card__poster">
          <img src="${event.poster}" alt="${event.name}" loading="lazy">
          <div class="date-badge">
            <span class="date-badge__month">${badge.month}</span>
            <span class="date-badge__day">${badge.day}</span>
          </div>
        </div>
        <div class="event-card__body">
          <h3 class="event-card__name">${event.name}</h3>
          <p class="event-card__meta">${formatDateMeta(event.date, event.startTime, event.endTime)}</p>
          <p class="event-card__meta">${event.location}</p>
          ${lineup}
        </div>
      </a>
      <div class="event-card__actions">${actions}</div>
    </div>
  `;
}

async function loadEventsManifest() {
  const res = await fetch('assets/events/manifest.json');
  if (!res.ok) throw new Error('Failed to load events manifest');
  return res.json();
}
