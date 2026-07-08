// Shared YouTube + SoundCloud embed helpers — used by music.js (Music page) and main.js (Home page teasers)

function extractYouTubeId(url) {
  if (!url) return null;
  const match = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (match) return match[1];
  return /^[a-zA-Z0-9_-]{11}$/.test(url.trim()) ? url.trim() : null;
}

function renderVideoMedia(video) {
  const id = video.youtubeId || extractYouTubeId(video.youtubeUrl);
  if (id) {
    return `<iframe src="https://www.youtube.com/embed/${id}" title="${video.title}" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
  }
  return `
    <a href="${video.youtubeUrl || '#'}" target="_blank" rel="noopener" class="video-placeholder">
      <span class="video-placeholder__label">Avec Anima<br>Placeholder Video</span>
      <span class="play-badge">&#9654;</span>
    </a>
  `;
}

function renderSoundcloudWaveform() {
  const bars = Array.from({ length: 40 }, () => 20 + Math.round(Math.random() * 80));
  return bars.map((h) => `<span style="height: ${h}%;"></span>`).join('');
}

function renderSoundcloud(data) {
  if (data.embedUrl) {
    const src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(data.embedUrl)}&color=%23ffffff&auto_play=false&show_user=true`;
    return `<div class="soundcloud-embed"><iframe src="${src}" height="300" scrolling="no" frameborder="no" allow="autoplay"></iframe></div>`;
  }
  return `
    <div class="soundcloud-card">
      <div class="soundcloud-card__top">
        <span class="soundcloud-card__play">&#9654;</span>
        <div>
          <p class="soundcloud-card__title">${data.playlistTitle}</p>
          <p class="soundcloud-card__subtitle">Placeholder — SoundCloud embed goes here</p>
        </div>
      </div>
      <div class="soundcloud-card__waveform">${renderSoundcloudWaveform()}</div>
    </div>
  `;
}
