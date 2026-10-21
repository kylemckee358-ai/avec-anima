// Music page — Watch (YouTube) + Listen (SoundCloud)
// The first video plays in the big player; the rest are lightweight thumbnail cards that
// load into the player when clicked (no YouTube iframe until someone actually picks one).
// Videos without a real YouTube link show a placeholder linking to `youtubeUrl`.
// SoundCloud embeds as soon as `embedUrl` is set (see js/media-helpers.js).

function youtubeEmbed(id, autoplay) {
  return `<iframe src="https://www.youtube.com/embed/${id}${autoplay ? '?autoplay=1' : ''}" title="YouTube video" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
}

function renderFeaturedVideo(video) {
  return `
    <div class="featured-video">${renderVideoMedia(video)}</div>
    <div class="featured-video__meta">
      <p class="section-label">Now Playing</p>
      <h3 class="featured-video__caption">${video.title}</h3>
    </div>
  `;
}

function renderVideoCard(video, index) {
  const id = video.youtubeId || extractYouTubeId(video.youtubeUrl);
  const thumb = id
    ? `<img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" loading="lazy">`
    : '<span class="video-placeholder__label">Avec Anima<br>Coming Soon</span>';

  // Real videos load into the big player; placeholders just link out
  const open = id
    ? `<button type="button" class="video-card" data-index="${index}">`
    : `<a class="video-card" href="${video.youtubeUrl || '#'}" target="_blank" rel="noopener">`;
  const close = id ? '</button>' : '</a>';

  return `
    ${open}
      <span class="video-card__thumb">
        ${thumb}
        <span class="play-badge">&#9654;</span>
      </span>
      <span class="video-card__title">${video.title}</span>
    ${close}
  `;
}

function playInFeatured(video) {
  const id = video.youtubeId || extractYouTubeId(video.youtubeUrl);
  const featured = document.getElementById('featured-video');
  featured.querySelector('.featured-video').innerHTML = youtubeEmbed(id, true);
  featured.querySelector('.featured-video__caption').textContent = video.title;
  featured.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

(async function () {
  const featuredEl = document.getElementById('featured-video');
  const moreEl = document.getElementById('more-videos');
  const soundcloudEl = document.getElementById('soundcloud-embed');

  try {
    const [videos, soundcloud] = await Promise.all([
      fetch('assets/music/videos.json').then((r) => r.json()),
      fetch('assets/music/soundcloud.json').then((r) => r.json()),
    ]);

    if (videos.length) {
      featuredEl.innerHTML = renderFeaturedVideo(videos[0]);
      if (videos.length > 1) {
        moreEl.innerHTML = `
          <p class="section-label more-videos__label">More Sets</p>
          <div class="video-grid">${videos.map((v, i) => (i === 0 ? '' : renderVideoCard(v, i))).join('')}</div>
        `;
        moreEl.addEventListener('click', (e) => {
          const card = e.target.closest('button.video-card');
          if (!card) return;
          moreEl.querySelectorAll('.video-card.is-playing').forEach((c) => c.classList.remove('is-playing'));
          card.classList.add('is-playing');
          playInFeatured(videos[Number(card.dataset.index)]);
        });
      }
    } else {
      featuredEl.innerHTML = '<p class="events-empty">No videos yet — check back soon.</p>';
    }

    soundcloudEl.innerHTML = renderSoundcloud(soundcloud);
    initSoundcloud(soundcloudEl);
  } catch (err) {
    featuredEl.innerHTML = '<p class="events-empty">Couldn\'t load videos. Refresh to try again.</p>';
    console.error(err);
  }
})();
