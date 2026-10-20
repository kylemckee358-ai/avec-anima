// Admin page — talks to the local Express API (server.js). Every action here
// writes real files; there is no undo beyond editing/re-adding things by hand.

function escapeAttr(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function setStatus(el, message, isError) {
  el.textContent = message;
  el.className = `admin-status ${isError ? 'is-error' : 'is-success'}`;
  // Errors stay on screen until the next action — auto-hiding them risks
  // looking like nothing happened when something actually failed.
  if (message && !isError) {
    setTimeout(() => { el.textContent = ''; el.className = 'admin-status'; }, 4000);
  }
}

// ── Events ──────────────────────────────────────────────────────────

function renderEventCard(event) {
  const lineup = event.lineup || [];
  const lineupChips = lineup.length
    ? lineup.map((artist, i) => `
        <div class="admin-lineup-chip">
          ${artist.photo
            ? `<img src="${artist.photo}" alt="${escapeAttr(artist.name)}">`
            : `<span class="admin-lineup-chip__na">N/A</span>`}
          <span>${artist.name}</span>
          <button type="button" data-action="remove-artist" data-category="${event.category}" data-slug="${event.slug}" data-index="${i}" title="Remove">&times;</button>
        </div>
      `).join('')
    : '<p class="admin-note">No lineup artists yet.</p>';

  const otherCategory = event.category === 'upcoming' ? 'previous' : 'upcoming';
  const moveLabel = event.category === 'upcoming' ? 'Move to Previous' : 'Move to Upcoming';

  return `
    <div class="admin-card" data-category="${event.category}" data-slug="${event.slug}">
      <div class="admin-card__header">
        <div>
          <p class="admin-card__title">${event.name}</p>
          <p class="admin-card__meta">${event.date} &middot; ${event.startTime || '?'}&ndash;${event.endTime || '?'} &middot; ${event.location || ''}</p>
        </div>
        <div class="admin-card__actions">
          <button type="button" class="btn btn--outline btn--small" data-action="move" data-to-category="${otherCategory}">${moveLabel}</button>
          <button type="button" class="btn btn--danger btn--small" data-action="delete">Delete</button>
        </div>
      </div>

      <div class="admin-card__body">
        <form class="edit-event-form">
          <div class="field"><label>Event Name</label><input type="text" name="name" value="${escapeAttr(event.name)}"></div>
          <div class="fields-row">
            <div class="field"><label>Date</label><input type="date" name="date" value="${escapeAttr(event.date)}"></div>
            <div class="field"><label>Location</label><input type="text" name="location" value="${escapeAttr(event.location)}"></div>
          </div>
          <div class="fields-row">
            <div class="field"><label>Start Time</label><input type="time" name="startTime" value="${escapeAttr(event.startTime)}"></div>
            <div class="field"><label>End Time</label><input type="time" name="endTime" value="${escapeAttr(event.endTime)}"></div>
          </div>
          <div class="field"><label>Ticket Link</label><input type="text" name="ticketLink" value="${escapeAttr(event.ticketLink)}"></div>
          <div class="field"><label>Description</label><textarea name="description">${event.description || ''}</textarea></div>
          <div class="field"><label>Full-Quality Photos (Google Drive link)</label><input type="text" name="driveLink" value="${escapeAttr(event.driveLink)}" placeholder="https://drive.google.com/drive/folders/..."></div>
          <button type="submit" class="btn btn--solid btn--small">Save Changes</button>
        </form>

        <div style="margin-top: 24px;">
          <label style="display:block; font-size:11px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--text-secondary); margin-bottom:8px;">Lineup</label>
          <div class="admin-lineup-list">${lineupChips}</div>
          <form class="add-artist-form" style="display:flex; gap:8px; align-items:end; flex-wrap:wrap;">
            <div class="field" style="margin-bottom:0;"><input type="text" name="name" placeholder="Artist name" required></div>
            <div class="field" style="margin-bottom:0;"><input type="file" name="photo" accept="image/*"></div>
            <button type="submit" class="btn btn--outline btn--small">Add Artist</button>
          </form>
          <p class="admin-note" style="margin-top: 6px;">Headshot is optional — leave it blank if they don't have one, it'll just show "N/A" instead.</p>
        </div>

        <div style="margin-top: 24px;">
          <label style="display:block; font-size:11px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--text-secondary); margin-bottom:8px;">Replace Poster</label>
          <form class="replace-poster-form" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <input type="file" name="poster" accept="image/*" required>
            <button type="submit" class="btn btn--outline btn--small">Upload</button>
          </form>
        </div>

        ${renderGalleryAdmin(event)}
      </div>
    </div>
  `;
}

const ADMIN_LABEL_STYLE = 'display:block; font-size:11px; font-weight:600; letter-spacing:.1em; text-transform:uppercase; color:var(--text-secondary); margin-bottom:8px;';

// After movie + gallery photos for the Gallery & After Movies page
function renderGalleryAdmin(event) {
  const gallery = event.gallery || [];
  const aftermovie = event.aftermovie
    ? `
      <div class="admin-aftermovie">
        <video src="${event.aftermovie}" poster="${event.aftermoviePoster || ''}" controls preload="none" playsinline></video>
        <button type="button" class="btn btn--danger btn--small" data-action="remove-aftermovie">Remove After Movie</button>
      </div>
    `
    : '<p class="admin-note">No after movie yet.</p>';

  const photos = gallery.length
    ? `<div class="admin-gallery-grid">${gallery.map((photo) => `
        <div class="admin-gallery-thumb">
          <img src="${photo.thumb}" alt="" loading="lazy">
          <button type="button" data-action="remove-photo" data-file="${photo.src.split('/').pop()}" title="Remove">&times;</button>
        </div>
      `).join('')}</div>`
    : '<p class="admin-note">No gallery photos yet.</p>';

  return `
    <div style="margin-top: 24px;">
      <label style="${ADMIN_LABEL_STYLE}">After Movie</label>
      ${aftermovie}
      <form class="aftermovie-form" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top: 8px;">
        <input type="file" name="video" accept="video/*" required>
        <button type="submit" class="btn btn--outline btn--small">${event.aftermovie ? 'Replace' : 'Upload'}</button>
      </form>
      <p class="admin-note" style="margin-top: 6px;">Any size or format — it's compressed to web-ready 1080p automatically. Takes a minute or two.</p>
      <p class="admin-status"></p>
    </div>

    <div style="margin-top: 24px;">
      <label style="${ADMIN_LABEL_STYLE}">Gallery Photos (${gallery.length})</label>
      ${photos}
      <form class="gallery-form" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top: 8px;">
        <input type="file" name="photos" accept="image/*" multiple required>
        <button type="submit" class="btn btn--outline btn--small">Add Photos</button>
      </form>
      <p class="admin-note" style="margin-top: 6px;">Select several at once (up to 60). They're resized for the web — put the full-quality originals in the Google Drive folder above.</p>
      <p class="admin-status"></p>
    </div>
  `;
}

// One malformed event shouldn't blank out the whole list — render each
// card defensively so a single bad entry can't take the others down with it.
function renderEventCardSafe(event) {
  try {
    return renderEventCard(event);
  } catch (err) {
    console.error('Failed to render event card', event, err);
    return `<div class="admin-card"><p class="admin-card__title">${event.name || event.slug || 'Unknown event'}</p><p class="admin-note">Couldn't display this event (${err.message}).</p></div>`;
  }
}

async function loadEvents() {
  const res = await fetch('/api/events');
  const { upcoming, previous } = await res.json();

  const upcomingEl = document.getElementById('upcoming-admin-list');
  const previousEl = document.getElementById('previous-admin-list');

  upcomingEl.innerHTML = upcoming.length
    ? upcoming.map((e) => renderEventCardSafe({ ...e, category: 'upcoming' })).join('')
    : '<p class="admin-note">No upcoming events.</p>';

  previousEl.innerHTML = previous.length
    ? previous.map((e) => renderEventCardSafe({ ...e, category: 'previous' })).join('')
    : '<p class="admin-note">No previous events.</p>';
}

function wireEventListDelegation(container) {
  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const card = btn.closest('.admin-card');
    const { category, slug } = card.dataset;

    if (btn.dataset.action === 'delete') {
      if (!confirm(`Delete "${card.querySelector('.admin-card__title').textContent}"? This can't be undone.`)) return;
      await fetch(`/api/events/${category}/${slug}`, { method: 'DELETE' });
      loadEvents();
      return;
    }

    if (btn.dataset.action === 'move') {
      await fetch(`/api/events/${category}/${slug}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toCategory: btn.dataset.toCategory }),
      });
      loadEvents();
      return;
    }

    if (btn.dataset.action === 'remove-aftermovie') {
      if (!confirm('Remove this after movie?')) return;
      await fetch(`/api/events/${category}/${slug}/aftermovie`, { method: 'DELETE' });
      loadEvents();
      return;
    }

    if (btn.dataset.action === 'remove-photo') {
      await fetch(`/api/events/${category}/${slug}/gallery/${btn.dataset.file}`, { method: 'DELETE' });
      loadEvents();
      return;
    }

    if (btn.dataset.action === 'remove-artist') {
      await fetch(`/api/events/${category}/${slug}/lineup/${btn.dataset.index}`, { method: 'DELETE' });
      loadEvents();
    }
  });

  container.addEventListener('submit', async (e) => {
    const form = e.target;
    const card = form.closest('.admin-card');
    const { category, slug } = card.dataset;
    e.preventDefault();

    if (form.classList.contains('edit-event-form')) {
      const data = Object.fromEntries(new FormData(form).entries());
      await fetch(`/api/events/${category}/${slug}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      loadEvents();
      return;
    }

    if (form.classList.contains('add-artist-form')) {
      await fetch(`/api/events/${category}/${slug}/lineup`, { method: 'POST', body: new FormData(form) });
      loadEvents();
      return;
    }

    if (form.classList.contains('aftermovie-form') || form.classList.contains('gallery-form')) {
      const isVideo = form.classList.contains('aftermovie-form');
      const status = form.parentElement.querySelector('.admin-status');
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      // Set directly — setStatus auto-clears success messages, and this one must stay up while ffmpeg runs
      status.className = 'admin-status';
      status.textContent = isVideo ? 'Uploading and compressing… this can take a minute or two.' : 'Uploading photos…';

      const endpoint = isVideo ? 'aftermovie' : 'gallery';
      const res = await fetch(`/api/events/${category}/${slug}/${endpoint}`, { method: 'POST', body: new FormData(form) });
      const result = await res.json().catch(() => ({}));
      button.disabled = false;

      if (!res.ok) {
        setStatus(status, result.error || 'Upload failed', true);
        return;
      }
      if (result.failed && result.failed.length) {
        alert(`Couldn't read: ${result.failed.join(', ')}`);
      }
      loadEvents();
      return;
    }

    if (form.classList.contains('replace-poster-form')) {
      await fetch(`/api/events/${category}/${slug}/poster`, { method: 'POST', body: new FormData(form) });
      loadEvents();
    }
  });
}

function renderAddEventArtistRow(index) {
  return `
    <div class="admin-lineup-row" data-row-index="${index}">
      <div class="field" style="margin-bottom: 0;"><label>Artist Name</label><input type="text" name="artistName_${index}" placeholder="Artist name"></div>
      <div class="field" style="margin-bottom: 0;"><label>Headshot (optional)</label><input type="file" name="artistPhoto_${index}" accept="image/*"></div>
      <button type="button" class="btn btn--danger btn--small" data-action="remove-artist-row">Remove</button>
    </div>
  `;
}

function wireAddEventForm() {
  const form = document.getElementById('add-event-form');
  const status = document.getElementById('add-event-status');
  const rowsEl = document.getElementById('ae-lineup-rows');
  let nextArtistIndex = 0;

  document.getElementById('ae-add-artist').addEventListener('click', () => {
    rowsEl.insertAdjacentHTML('beforeend', renderAddEventArtistRow(nextArtistIndex));
    nextArtistIndex += 1;
  });

  rowsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="remove-artist-row"]');
    if (!btn) return;
    btn.closest('.admin-lineup-row').remove();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    setStatus(status, 'Uploading…', false);

    try {
      const res = await fetch('/api/events', { method: 'POST', body: new FormData(form) });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.error || `Failed to add event (server said: ${res.status})`);
      setStatus(status, `Added "${form.name.value}".`, false);
      form.reset();
      rowsEl.innerHTML = '';
      nextArtistIndex = 0;
      loadEvents();
    } catch (err) {
      setStatus(status, err.message, true);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ── Music: videos ───────────────────────────────────────────────────

function renderVideoRow(video) {
  return `
    <div class="admin-video-row">
      <div class="field" style="margin-bottom: 0;"><label>Title</label><input type="text" class="v-title" value="${escapeAttr(video.title)}"></div>
      <div class="field" style="margin-bottom: 0;"><label>YouTube URL</label><input type="text" class="v-url" value="${escapeAttr(video.youtubeUrl || '')}" placeholder="Paste the full video link, or # for a placeholder"></div>
      <button type="button" class="btn btn--danger btn--small" data-action="remove-video">Remove</button>
    </div>
  `;
}

async function loadVideos() {
  const videos = await fetch('/api/music/videos').then((r) => r.json());
  document.getElementById('video-rows').innerHTML = videos.map(renderVideoRow).join('');
}

function wireVideoEditor() {
  const rowsEl = document.getElementById('video-rows');
  const status = document.getElementById('videos-status');

  rowsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="remove-video"]');
    if (!btn) return;
    btn.closest('.admin-video-row').remove();
  });

  document.getElementById('add-video-row').addEventListener('click', () => {
    rowsEl.insertAdjacentHTML('beforeend', renderVideoRow({ title: '', youtubeUrl: '#' }));
  });

  document.getElementById('save-videos').addEventListener('click', async () => {
    const videos = Array.from(rowsEl.querySelectorAll('.admin-video-row')).map((row) => ({
      title: row.querySelector('.v-title').value,
      youtubeId: null,
      youtubeUrl: row.querySelector('.v-url').value || '#',
    }));

    await fetch('/api/music/videos', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(videos),
    });
    setStatus(status, 'Videos saved.', false);
  });
}

// ── Music: SoundCloud ───────────────────────────────────────────────

function wireSoundcloudForm() {
  const form = document.getElementById('soundcloud-form');
  const status = document.getElementById('soundcloud-status');

  fetch('/api/music/soundcloud').then((r) => r.json()).then((data) => {
    form.playlistTitle.value = data.playlistTitle || '';
    form.embedUrl.value = data.embedUrl || '';
    form.profileUrl.value = data.profileUrl || '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    data.embedUrl = data.embedUrl || null;
    await fetch('/api/music/soundcloud', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    setStatus(status, 'SoundCloud settings saved.', false);
  });
}

// ── Init ──────────────────────────────────────────────────────────────

wireEventListDelegation(document.getElementById('upcoming-admin-list'));
wireEventListDelegation(document.getElementById('previous-admin-list'));
wireAddEventForm();
wireVideoEditor();
wireSoundcloudForm();
loadEvents();
loadVideos();
