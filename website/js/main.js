// Home page — renders the next 3 upcoming events + Music/SoundCloud teasers

(async function () {
  const container = document.getElementById('home-upcoming-events');

  try {
    const { upcoming } = await loadEventsManifest();

    if (!upcoming.length) {
      container.innerHTML = '<p class="events-empty">No upcoming events right now — check back soon.</p>';
      return;
    }

    container.innerHTML = upcoming.slice(0, 3).map((event) => renderEventCard(event, false)).join('');
  } catch (err) {
    container.innerHTML = '<p class="events-empty">Couldn\'t load events. Refresh to try again.</p>';
    console.error(err);
  }
})();

(async function () {
  const el = document.getElementById('home-featured-video');

  try {
    const videos = await fetch('assets/music/videos.json').then((r) => r.json());
    if (!videos.length) {
      el.innerHTML = '<p class="events-empty">No videos yet — check back soon.</p>';
      return;
    }
    el.innerHTML = `<div class="featured-video">${renderVideoMedia(videos[0])}</div>`;
  } catch (err) {
    el.innerHTML = '<p class="events-empty">Couldn\'t load videos.</p>';
    console.error(err);
  }
})();

(async function () {
  const el = document.getElementById('home-soundcloud-embed');

  try {
    const soundcloud = await fetch('assets/music/soundcloud.json').then((r) => r.json());
    el.innerHTML = renderSoundcloud(soundcloud);
  } catch (err) {
    el.innerHTML = '<p class="events-empty">Couldn\'t load SoundCloud.</p>';
    console.error(err);
  }
})();
