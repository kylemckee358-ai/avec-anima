// Music page — Watch (YouTube) + SoundCloud sections
// Videos render as a real embed as soon as a real YouTube URL is set (the video ID
// is extracted automatically, see js/media-helpers.js); until then they show a
// placeholder linking to `youtubeUrl`. Same pattern for SoundCloud's `embedUrl`.

function renderFeaturedVideo(video) {
  return `
    <div class="featured-video">${renderVideoMedia(video)}</div>
    <h2 class="featured-video__caption">${video.title}</h2>
  `;
}

function renderVideoCard(video) {
  return `
    <div class="video-card">
      <div class="video-card__thumb">${renderVideoMedia(video)}</div>
      <p class="video-card__title">${video.title}</p>
    </div>
  `;
}

(async function () {
  const featuredEl = document.getElementById('featured-video');
  const gridEl = document.getElementById('video-grid');
  const soundcloudEl = document.getElementById('soundcloud-embed');

  try {
    const [videos, soundcloud] = await Promise.all([
      fetch('assets/music/videos.json').then((r) => r.json()),
      fetch('assets/music/soundcloud.json').then((r) => r.json()),
    ]);

    if (videos.length) {
      featuredEl.innerHTML = renderFeaturedVideo(videos[0]);
      gridEl.innerHTML = videos.slice(1).map(renderVideoCard).join('');
    } else {
      featuredEl.innerHTML = '<p class="events-empty">No videos yet — check back soon.</p>';
    }

    soundcloudEl.innerHTML = renderSoundcloud(soundcloud);
  } catch (err) {
    featuredEl.innerHTML = '<p class="events-empty">Couldn\'t load videos. Refresh to try again.</p>';
    console.error(err);
  }
})();
