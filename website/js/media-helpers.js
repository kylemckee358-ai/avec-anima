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

// soundcloud.json holds { playlists: [{ title, embedUrl }] }. Older files held a single
// { playlistTitle, embedUrl } — read that as a one-playlist list.
function soundcloudPlaylists(data) {
  if (Array.isArray(data.playlists)) return data.playlists.filter((p) => p.embedUrl);
  return data.embedUrl ? [{ title: data.playlistTitle, embedUrl: data.embedUrl }] : [];
}

function soundcloudPlayerSrc(url) {
  return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ffffff&auto_play=false&show_user=true`;
}

function escapeSoundcloudText(str) {
  return String(str || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// One playlist → a plain player. Two or more → a carousel (wired up by initSoundcloud).
function renderSoundcloud(data) {
  const playlists = soundcloudPlaylists(data);

  if (!playlists.length) {
    return `
      <div class="soundcloud-card">
        <div class="soundcloud-card__top">
          <span class="soundcloud-card__play">&#9654;</span>
          <div>
            <p class="soundcloud-card__title">${escapeSoundcloudText(data.playlistTitle || 'Avec Anima Playlists')}</p>
            <p class="soundcloud-card__subtitle">Placeholder — SoundCloud embed goes here</p>
          </div>
        </div>
        <div class="soundcloud-card__waveform">${renderSoundcloudWaveform()}</div>
      </div>
    `;
  }

  if (playlists.length === 1) {
    return `<div class="soundcloud-embed"><iframe src="${soundcloudPlayerSrc(playlists[0].embedUrl)}" title="${escapeSoundcloudText(playlists[0].title || 'SoundCloud playlist')}" height="300" scrolling="no" frameborder="no" allow="autoplay"></iframe></div>`;
  }

  // Only the first player loads up front; the rest load the first time they're shown.
  return `
    <div class="sc-carousel" data-sc-carousel>
      <div class="sc-carousel__bar">
        <p class="sc-carousel__title" aria-live="polite">${escapeSoundcloudText(playlists[0].title || 'Playlist 1')}</p>
        <div class="sc-carousel__nav">
          <span class="sc-carousel__count">1 / ${playlists.length}</span>
          <button type="button" class="sc-carousel__btn" data-sc-prev aria-label="Previous playlist">&#8249;</button>
          <button type="button" class="sc-carousel__btn" data-sc-next aria-label="Next playlist">&#8250;</button>
        </div>
      </div>
      <div class="sc-carousel__viewport">
        <div class="sc-carousel__track">
          ${playlists.map((p, i) => `
            <div class="sc-carousel__slide soundcloud-embed" data-title="${escapeSoundcloudText(p.title || `Playlist ${i + 1}`)}"${i === 0 ? '' : ' aria-hidden="true"'}>
              <iframe ${i === 0 ? 'src' : 'data-src'}="${soundcloudPlayerSrc(p.embedUrl)}" title="${escapeSoundcloudText(p.title || `Playlist ${i + 1}`)}" height="300" scrolling="no" frameborder="no" allow="autoplay"></iframe>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="sc-carousel__dots">
        ${playlists.map((p, i) => `<button type="button" class="sc-carousel__dot${i === 0 ? ' is-active' : ''}" data-sc-dot="${i}" aria-label="Show ${escapeSoundcloudText(p.title || `playlist ${i + 1}`)}"></button>`).join('')}
      </div>
    </div>
  `;
}

function initSoundcloud(container) {
  const root = container.querySelector('[data-sc-carousel]');
  if (!root) return;

  const track = root.querySelector('.sc-carousel__track');
  const slides = Array.from(root.querySelectorAll('.sc-carousel__slide'));
  const dots = Array.from(root.querySelectorAll('.sc-carousel__dot'));
  const titleEl = root.querySelector('.sc-carousel__title');
  const countEl = root.querySelector('.sc-carousel__count');
  let current = 0;

  function show(index) {
    const next = (index + slides.length) % slides.length;
    if (next === current) return;

    // Reloading the player we're leaving is the simplest way to stop it playing.
    const leaving = slides[current].querySelector('iframe');
    if (leaving.src) leaving.src = leaving.src;
    slides[current].setAttribute('aria-hidden', 'true');

    const arriving = slides[next].querySelector('iframe');
    if (!arriving.src) arriving.src = arriving.dataset.src;
    slides[next].removeAttribute('aria-hidden');

    current = next;
    track.style.transform = `translateX(-${current * 100}%)`;
    titleEl.textContent = slides[current].dataset.title;
    countEl.textContent = `${current + 1} / ${slides.length}`;
    dots.forEach((dot, i) => dot.classList.toggle('is-active', i === current));
  }

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-sc-prev]')) show(current - 1);
    else if (e.target.closest('[data-sc-next]')) show(current + 1);
    else if (e.target.closest('[data-sc-dot]')) show(Number(e.target.closest('[data-sc-dot]').dataset.scDot));
  });
}

// Lets lib/seo.js build YouTube thumbnail URLs for the Music page banner
if (typeof module !== 'undefined') {
  module.exports = { extractYouTubeId };
}
