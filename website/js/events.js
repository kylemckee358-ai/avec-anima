// Events page — renders full Upcoming and Previous lists

(async function () {
  const upcomingEl = document.getElementById('upcoming-events');
  const previousEl = document.getElementById('previous-events');

  try {
    const { upcoming, previous } = await loadEventsManifest();

    upcomingEl.innerHTML = upcoming.length
      ? upcoming.map((event) => renderEventCard(event, false)).join('')
      : '<p class="events-empty">No upcoming events right now — check back soon.</p>';

    previousEl.innerHTML = previous.length
      ? previous.map((event) => renderEventCard(event, true)).join('')
      : '<p class="events-empty">Nothing here yet.</p>';
  } catch (err) {
    upcomingEl.innerHTML = '<p class="events-empty">Couldn\'t load events. Refresh to try again.</p>';
    previousEl.innerHTML = '';
    console.error(err);
  }
})();
