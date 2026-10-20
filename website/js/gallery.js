// Gallery & After Movies page — one section per event that has an after movie or photos, newest first.
// After movies play muted on hover; clicking plays from the start with sound.
// Photos open in a lightbox (prev/next, Esc, swipe). Thumbnails link to the full image so it
// still works without JavaScript — and lib/seo.js pre-renders this same markup for crawlers.

function formatGalleryDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  });
}

function eventsWithMedia({ upcoming, previous }) {
  return [...upcoming, ...previous]
    .filter((e) => e.aftermovie || (e.gallery && e.gallery.length))
    .sort((a, b) => b.date.localeCompare(a.date));
}

// Layout per section (see .gallery-section--* in style.css):
//   landscape — 16:9 film left, 3×4 photo preview + "View all" right
//   portrait  — vertical film left, 5×4 photo preview + "View all" right
//   photos    — no film, preview grid full width
// Every photo is in the markup (lightbox + crawlers); CSS hides the ones past the preview count.
function renderGallerySection(event) {
  const venue = (event.location || '').split(',')[0];
  const photos = event.gallery || [];
  const isPortrait = event.aftermovieOrientation === 'portrait';
  const layout = !event.aftermovie ? 'photos' : isPortrait ? 'portrait' : 'landscape';

  const aftermovie = event.aftermovie ? `
    <div class="aftermovie${isPortrait ? ' aftermovie--portrait' : ''}" data-aftermovie>
      <video src="${event.aftermovie}" poster="${event.aftermoviePoster || ''}" muted loop playsinline preload="none"></video>
      <button type="button" class="aftermovie__play" aria-label="Play ${event.name} after movie with sound">
        <span>&#9654;</span>
      </button>
    </div>
  ` : '';

  const side = photos.length ? `
    <div class="gallery-side">
      <div class="gallery-grid">
        ${photos.map((photo, i) => `
          <a class="gallery-grid__item" href="${photo.src}" data-lightbox="${event.slug}" data-index="${i}">
            <img src="${photo.thumb}" alt="${event.name} — photo ${i + 1}" loading="lazy">
          </a>
        `).join('')}
      </div>
      <button type="button" class="btn btn--outline gallery-all" data-view-all="${event.slug}">
        View All ${photos.length} Photos
      </button>
    </div>
  ` : '';

  const download = event.driveLink
    ? ` &middot; <a href="${event.driveLink}" target="_blank" rel="noopener" class="gallery-section__download">Download full-quality photos</a>`
    : '';

  return `
    <section class="gallery-section gallery-section--${photos.length ? layout : 'film'}" id="${event.slug}" data-drive-link="${event.driveLink || ''}">
      <div class="gallery-section__header">
        <h2 class="section-title gallery-section__title">${event.name}</h2>
        <p class="gallery-section__meta">${formatGalleryDate(event.date)}${venue ? ` &middot; ${venue}` : ''}${download}</p>
      </div>
      <div class="gallery-layout">
        ${aftermovie}
        ${side}
      </div>
    </section>
  `;
}

function renderGallery(manifest) {
  const events = eventsWithMedia(manifest);
  return events.length
    ? events.map(renderGallerySection).join('')
    : '<p class="events-empty">Photos and after movies from our nights land here soon.</p>';
}

// ── After movie playback ─────────────────────────────────────────────

function wireAftermovies(root) {
  root.addEventListener('mouseover', (e) => {
    const wrap = e.target.closest('[data-aftermovie]');
    if (!wrap || wrap.classList.contains('is-active') || wrap.contains(e.relatedTarget)) return;
    const video = wrap.querySelector('video');
    video.muted = true;
    video.play().catch(() => {});
  });

  root.addEventListener('mouseout', (e) => {
    const wrap = e.target.closest('[data-aftermovie]');
    if (!wrap || wrap.classList.contains('is-active') || wrap.contains(e.relatedTarget)) return;
    wrap.querySelector('video').pause();
  });

  root.addEventListener('click', (e) => {
    const wrap = e.target.closest('[data-aftermovie]');
    if (!wrap || wrap.classList.contains('is-active')) return;

    // Only one after movie plays with sound at a time
    root.querySelectorAll('[data-aftermovie].is-active video').forEach((v) => v.pause());

    const video = wrap.querySelector('video');
    wrap.classList.add('is-active');
    video.loop = false;
    video.controls = true;
    video.currentTime = 0;
    video.muted = false;
    video.play().catch(() => {});
  });
}

// ── Lightbox ─────────────────────────────────────────────────────────

function createLightbox() {
  const box = document.createElement('div');
  box.className = 'lightbox';
  box.hidden = true;
  box.innerHTML = `
    <img class="lightbox__img" alt="">
    <button type="button" class="lightbox__btn lightbox__btn--close" aria-label="Close">&times;</button>
    <button type="button" class="lightbox__btn lightbox__btn--prev" aria-label="Previous photo">&#8249;</button>
    <button type="button" class="lightbox__btn lightbox__btn--next" aria-label="Next photo">&#8250;</button>
    <div class="lightbox__bar">
      <p class="lightbox__count"></p>
      <a class="lightbox__download" target="_blank" rel="noopener" hidden>Download Full-Quality Photos</a>
    </div>
  `;
  document.body.appendChild(box);
  return box;
}

function wireLightbox(root) {
  const box = createLightbox();
  const img = box.querySelector('.lightbox__img');
  const count = box.querySelector('.lightbox__count');
  const download = box.querySelector('.lightbox__download');
  let items = [];
  let index = 0;

  function show(i) {
    index = (i + items.length) % items.length;
    const link = items[index];
    img.src = link.href;
    img.alt = link.querySelector('img').alt;
    count.textContent = `${index + 1} / ${items.length}`;
  }

  function open(group, i) {
    items = Array.from(root.querySelectorAll(`[data-lightbox="${group}"]`));
    const driveLink = document.getElementById(group).dataset.driveLink;
    download.hidden = !driveLink;
    if (driveLink) download.href = driveLink;
    box.hidden = false;
    document.body.style.overflow = 'hidden';
    show(i);
  }

  function close() {
    box.hidden = true;
    img.removeAttribute('src');
    document.body.style.overflow = '';
  }

  root.addEventListener('click', (e) => {
    const viewAll = e.target.closest('[data-view-all]');
    if (viewAll) {
      open(viewAll.dataset.viewAll, 0);
      return;
    }

    const link = e.target.closest('[data-lightbox]');
    if (!link) return;
    e.preventDefault();
    open(link.dataset.lightbox, Number(link.dataset.index));
  });

  box.addEventListener('click', (e) => {
    if (e.target.closest('.lightbox__btn--prev')) show(index - 1);
    else if (e.target.closest('.lightbox__btn--next')) show(index + 1);
    else if (e.target !== img && !e.target.closest('.lightbox__download')) close();
  });

  document.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'ArrowRight') show(index + 1);
  });

  let touchX = null;
  box.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  box.addEventListener('touchend', (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
    touchX = null;
  });
}

if (typeof document !== 'undefined') (async function () {
  const root = document.getElementById('gallery-root');
  wireAftermovies(root);
  wireLightbox(root);

  try {
    root.innerHTML = renderGallery(await loadEventsManifest());
    // Content arrives after load, so re-apply a #slug jump from an event page
    if (window.location.hash) {
      const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)));
      if (target) target.scrollIntoView();
    }
  } catch (err) {
    console.error(err);
    // Keep the pre-rendered sections if the manifest fetch fails
  }
})();

// Lets lib/seo.js pre-render the gallery in Node
if (typeof module !== 'undefined') {
  module.exports = { renderGallery, eventsWithMedia };
}
