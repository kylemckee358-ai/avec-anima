// Admin page — talks to the local Express API (server.js). Every action here
// writes real files; there is no undo beyond editing/re-adding things by hand.
//
// Tabs: Events (details, poster, lineup) · Gallery & After Movies (film, photos, Drive link)
//       · Music (YouTube, SoundCloud) · Site Settings (links, page text, Google titles)

function escapeAttr(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Feedback ──────────────────────────────────────────────────────────

let toastTimer = null;

// Errors stay on screen until the next message — auto-hiding them risks
// looking like nothing happened when something actually failed.
function toast(message, isError = false, sticky = false) {
  const el = document.getElementById('admin-toast');
  el.textContent = message;
  el.className = `admin-toast${isError ? ' is-error' : ''}`;
  el.hidden = false;
  clearTimeout(toastTimer);
  if (!isError && !sticky) toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

async function api(method, url, body) {
  const options = { method };
  if (body instanceof FormData) options.body = body;
  else if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const res = await fetch(url, options);
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || `Request failed (${res.status})`);
  return result;
}

// fetch() can't report upload progress — big videos need it
function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    });
    xhr.upload.addEventListener('load', () => onProgress(100));
    xhr.addEventListener('load', () => {
      let result = {};
      try { result = JSON.parse(xhr.responseText); } catch (err) { /* non-JSON error page */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(result);
      else reject(new Error(result.error || `Upload failed (${xhr.status})`));
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed — is node server.js still running?')));
    xhr.send(formData);
  });
}

// ── Tabs ──────────────────────────────────────────────────────────────

const TABS = ['events', 'gallery', 'music', 'settings'];

function showTab(name) {
  const tab = TABS.includes(name) ? name : 'events';
  document.querySelectorAll('.admin-tab').forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', active);
  });
  document.querySelectorAll('.admin-panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tab;
  });
  if (window.location.hash !== `#${tab}`) history.replaceState(null, '', `#${tab}`);
}

function wireTabs() {
  document.querySelector('.admin-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.admin-tab');
    if (btn) showTab(btn.dataset.tab);
  });
  window.addEventListener('hashchange', () => showTab(window.location.hash.slice(1)));
  showTab(window.location.hash.slice(1));
}

// ── Shared event data ────────────────────────────────────────────────

let events = []; // [{ ...manifest entry, category }]
let cacheBust = Date.now(); // photos keep their filenames when reordered/replaced — force fresh images

function bust(src) {
  return src ? `${src}?v=${cacheBust}` : '';
}

function findEvent(category, slug) {
  return events.find((e) => e.category === category && e.slug === slug);
}

function eventBase(event) {
  return `assets/events/${event.category}/${event.slug}/`;
}

function apiBase(event) {
  return `/api/events/${event.category}/${event.slug}`;
}

// Keep expanded rows expanded when lists re-render after a save
function openKeys(container) {
  return new Set(Array.from(container.querySelectorAll('details[open]')).map((d) => d.dataset.key));
}

function restoreOpen(container, keys) {
  container.querySelectorAll('details[data-key]').forEach((d) => {
    if (keys.has(d.dataset.key)) d.open = true;
  });
}

function formatDate(dateStr) {
  if (!dateStr) return 'No date';
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

function rowSummary(event, badges) {
  const venue = (event.location || '').split(',')[0];
  return `
    <summary class="admin-row">
      <img class="admin-row__thumb" src="${bust(event.poster)}" alt="">
      <span class="admin-row__text">
        <span class="admin-row__title">${escapeHtml(event.name)}</span>
        <span class="admin-row__meta">${formatDate(event.date)}${venue ? ` &middot; ${escapeHtml(venue)}` : ''}</span>
      </span>
      <span class="admin-row__badges">${badges.join('')}</span>
    </summary>
  `;
}

function badge(text, on = true) {
  return `<span class="admin-badge${on ? '' : ' is-off'}">${text}</span>`;
}

async function loadEvents() {
  const { upcoming, previous } = await api('GET', '/api/events');
  cacheBust = Date.now();
  events = [
    ...upcoming.map((e) => ({ ...e, category: 'upcoming' })),
    ...previous.map((e) => ({ ...e, category: 'previous' })),
  ];
  renderEventLists();
  renderGalleryList();
}

async function refresh(message) {
  await loadEvents();
  if (message) toast(message);
}

// ── Events tab ───────────────────────────────────────────────────────

function renderLineupEditor(event) {
  const lineup = event.lineup || [];
  const rows = lineup.map((artist, i) => `
    <div class="admin-lineup-item" data-index="${i}">
      <div class="admin-lineup-item__photo">
        ${artist.photo ? `<img src="${bust(artist.photo)}" alt="">` : '<span>N/A</span>'}
      </div>
      <input type="text" class="lineup-name" value="${escapeAttr(artist.name)}" aria-label="Artist name">
      <label class="btn btn--outline btn--small admin-file-btn">
        ${artist.photo ? 'Change Photo' : 'Add Photo'}
        <input type="file" accept="image/*" data-action="artist-photo" hidden>
      </label>
      <div class="admin-lineup-item__order">
        <button type="button" class="admin-icon-btn" data-action="artist-up" title="Move up" ${i === 0 ? 'disabled' : ''}>&#8593;</button>
        <button type="button" class="admin-icon-btn" data-action="artist-down" title="Move down" ${i === lineup.length - 1 ? 'disabled' : ''}>&#8595;</button>
      </div>
      <button type="button" class="admin-icon-btn admin-icon-btn--danger" data-action="artist-remove" title="Remove">&times;</button>
    </div>
  `).join('');

  return `
    <div class="admin-lineup">
      ${rows || '<p class="admin-note">No lineup artists yet.</p>'}
    </div>
    <p class="admin-note" style="margin-top: 8px;">Names save when you click away from the box. Lineup order is the order shown on the event page. Headshots: square, at least 600 × 600 px, face centred.</p>
    <form class="add-artist-form admin-inline-form">
      <input type="text" name="name" placeholder="New artist name" required>
      <label class="btn btn--outline btn--small admin-file-btn">
        Headshot (optional)
        <input type="file" name="photo" accept="image/*" hidden>
      </label>
      <button type="submit" class="btn btn--outline btn--small">Add Artist</button>
    </form>
  `;
}

function renderEventEditor(event) {
  const otherCategory = event.category === 'upcoming' ? 'previous' : 'upcoming';
  const moveLabel = event.category === 'upcoming' ? 'Move to Previous' : 'Move to Upcoming';
  const lineupCount = (event.lineup || []).length;
  const photoCount = (event.gallery || []).length;

  return `
    <details class="admin-item" data-key="${event.category}/${event.slug}" data-category="${event.category}" data-slug="${event.slug}">
      ${rowSummary(event, [
        badge(`${lineupCount} artist${lineupCount === 1 ? '' : 's'}`, lineupCount > 0),
        badge('Film', Boolean(event.aftermovie)),
        badge(`${photoCount} photos`, photoCount > 0),
      ])}
      <div class="admin-item__body">
        <div class="admin-item__grid">
          <form class="edit-event-form admin-form">
            <h3 class="admin-subtitle">Details</h3>
            <div class="field"><label>Event Name</label><input type="text" name="name" value="${escapeAttr(event.name)}" required></div>
            <div class="fields-row">
              <div class="field"><label>Date</label><input type="date" name="date" value="${escapeAttr(event.date)}" required></div>
              <div class="field"><label>Location</label><input type="text" name="location" value="${escapeAttr(event.location)}"></div>
            </div>
            <div class="fields-row">
              <div class="field"><label>Start Time</label><input type="time" name="startTime" value="${escapeAttr(event.startTime)}"></div>
              <div class="field"><label>End Time</label><input type="time" name="endTime" value="${escapeAttr(event.endTime)}"></div>
            </div>
            <div class="field"><label>Ticket Link</label><input type="text" name="ticketLink" value="${escapeAttr(event.ticketLink)}" placeholder="https://... or # if not ready yet"></div>
            <div class="field"><label>Description</label><textarea name="description" rows="4">${escapeHtml(event.description)}</textarea></div>
            <button type="submit" class="btn btn--solid btn--small">Save Details</button>
          </form>

          <div>
            <h3 class="admin-subtitle">Poster</h3>
            <img class="admin-poster" src="${bust(event.poster)}" alt="">
            <label class="btn btn--outline btn--small admin-file-btn" style="margin-top: 10px;">
              Replace Poster
              <input type="file" accept="image/*" data-action="poster" hidden>
            </label>
            <p class="admin-note" style="margin-top: 8px;">Portrait, 1240 × 1754 px (A-paper shape). Other shapes get cropped to fit — Instagram 4:5 posters lose their sides. Larger files are resized automatically.</p>
          </div>
        </div>

        <h3 class="admin-subtitle">Lineup</h3>
        ${renderLineupEditor(event)}

        <div class="admin-item__footer">
          <a class="admin-link" href="${event.page}" target="_blank" rel="noopener">View event page &#8599;</a>
          <span class="admin-item__footer-actions">
            <button type="button" class="btn btn--outline btn--small" data-action="move" data-to-category="${otherCategory}">${moveLabel}</button>
            <button type="button" class="btn btn--danger btn--small" data-action="delete">Delete Event</button>
          </span>
        </div>
      </div>
    </details>
  `;
}

function renderEventLists() {
  for (const category of ['upcoming', 'previous']) {
    const container = document.getElementById(`${category}-admin-list`);
    const keys = openKeys(container);
    const list = events.filter((e) => e.category === category);
    container.innerHTML = list.length
      ? list.map(renderEventEditor).join('')
      : `<p class="admin-note">No ${category} events.</p>`;
    restoreOpen(container, keys);
  }
}

function lineupFromEvent(event) {
  // Manifest photo paths are site-relative; the API wants them relative to the event folder
  const base = eventBase(event);
  return (event.lineup || []).map((a) => ({ name: a.name, photo: a.photo ? a.photo.replace(base, '') : null }));
}

async function saveLineup(event, lineup, message) {
  await api('PUT', `${apiBase(event)}/lineup`, lineup);
  await refresh(message);
}

function wireEventsTab() {
  const panel = document.querySelector('[data-panel="events"]');

  panel.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    const item = btn && btn.closest('.admin-item');
    if (!item) return;
    const event = findEvent(item.dataset.category, item.dataset.slug);
    const action = btn.dataset.action;

    try {
      if (action === 'delete') {
        if (!confirm(`Delete "${event.name}" — poster, lineup, after movie and photos? This can't be undone.`)) return;
        await api('DELETE', apiBase(event));
        await refresh(`Deleted "${event.name}".`);
      } else if (action === 'move') {
        await api('POST', `${apiBase(event)}/move`, { toCategory: btn.dataset.toCategory });
        await refresh(`Moved to ${btn.dataset.toCategory}.`);
      } else if (action.startsWith('artist-')) {
        const index = Number(btn.closest('.admin-lineup-item').dataset.index);
        const lineup = lineupFromEvent(event);
        if (action === 'artist-remove') {
          if (!confirm(`Remove ${lineup[index].name} from the lineup?`)) return;
          lineup.splice(index, 1);
        } else {
          const to = action === 'artist-up' ? index - 1 : index + 1;
          [lineup[index], lineup[to]] = [lineup[to], lineup[index]];
        }
        await saveLineup(event, lineup, 'Lineup updated.');
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  // Artist names save when the box loses focus
  panel.addEventListener('change', async (e) => {
    const item = e.target.closest('.admin-item');
    if (!item) return;
    const event = findEvent(item.dataset.category, item.dataset.slug);

    try {
      if (e.target.classList.contains('lineup-name')) {
        const index = Number(e.target.closest('.admin-lineup-item').dataset.index);
        const name = e.target.value.trim();
        if (!name) {
          toast('Artist name can\'t be empty — use × to remove them.', true);
          e.target.value = event.lineup[index].name;
          return;
        }
        const lineup = lineupFromEvent(event);
        lineup[index].name = name;
        await saveLineup(event, lineup, 'Artist renamed.');
      } else if (e.target.dataset.action === 'artist-photo' && e.target.files[0]) {
        const index = Number(e.target.closest('.admin-lineup-item').dataset.index);
        const data = new FormData();
        data.append('photo', e.target.files[0]);
        toast('Uploading headshot…', false, true);
        await api('POST', `${apiBase(event)}/lineup/${index}/photo`, data);
        await refresh('Headshot updated.');
      } else if (e.target.dataset.action === 'poster' && e.target.files[0]) {
        const data = new FormData();
        data.append('poster', e.target.files[0]);
        toast('Uploading poster…', false, true);
        await api('POST', `${apiBase(event)}/poster`, data);
        await refresh('Poster replaced.');
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  panel.addEventListener('submit', async (e) => {
    const form = e.target;
    const item = form.closest('.admin-item');
    if (!item) return;
    e.preventDefault();
    const event = findEvent(item.dataset.category, item.dataset.slug);

    try {
      if (form.classList.contains('edit-event-form')) {
        await api('PUT', apiBase(event), Object.fromEntries(new FormData(form).entries()));
        await refresh('Details saved.');
      } else if (form.classList.contains('add-artist-form')) {
        await api('POST', `${apiBase(event)}/lineup`, new FormData(form));
        await refresh('Artist added.');
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  wireAddEventForm();
}

function renderAddEventArtistRow(index) {
  return `
    <div class="admin-lineup-row" data-index="${index}">
      <div class="field" style="margin-bottom: 0;"><label>Artist Name</label><input type="text" name="artistName_${index}" placeholder="e.g. Yeardos"></div>
      <div class="field" style="margin-bottom: 0;"><label>Headshot (optional)</label><input type="file" name="artistPhoto_${index}" accept="image/*"></div>
      <button type="button" class="btn btn--danger btn--small" data-action="remove-artist-row">Remove</button>
    </div>
  `;
}

function wireAddEventForm() {
  const form = document.getElementById('add-event-form');
  const rowsEl = document.getElementById('ae-lineup-rows');
  let nextArtistIndex = 0;

  function closeForm() {
    form.reset();
    rowsEl.innerHTML = '';
    nextArtistIndex = 0;
    form.hidden = true;
  }

  document.getElementById('toggle-add-event').addEventListener('click', () => {
    form.hidden = !form.hidden;
    if (!form.hidden) form.querySelector('input').focus();
  });
  document.getElementById('cancel-add-event').addEventListener('click', closeForm);

  document.getElementById('ae-add-artist').addEventListener('click', () => {
    rowsEl.insertAdjacentHTML('beforeend', renderAddEventArtistRow(nextArtistIndex));
    nextArtistIndex += 1;
  });

  rowsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action="remove-artist-row"]');
    if (btn) btn.closest('.admin-lineup-row').remove();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    toast('Creating event…', false, true);

    try {
      const name = form.name.value;
      const result = await api('POST', '/api/events', new FormData(form));
      closeForm();
      await refresh(`Created "${name}".`);
      const created = document.querySelector(`#${result.category}-admin-list details[data-key="${result.category}/${result.slug}"]`);
      if (created) {
        created.open = true;
        created.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    } catch (err) {
      toast(err.message, true);
    } finally {
      submitBtn.disabled = false;
    }
  });
}

// ── Gallery & After Movies tab ───────────────────────────────────────

// Must match the preview counts in style.css (.gallery-section--*)
function previewCount(event) {
  if (!event.aftermovie) return 24;
  return event.aftermovieOrientation === 'portrait' ? 20 : 12;
}

function renderGalleryEditor(event) {
  const photos = event.gallery || [];
  const preview = previewCount(event);
  const filmLabel = event.aftermovie
    ? (event.aftermovieOrientation === 'portrait' ? 'Vertical film' : 'Widescreen film')
    : 'No film';

  const film = event.aftermovie
    ? `
      <div class="admin-film${event.aftermovieOrientation === 'portrait' ? ' admin-film--portrait' : ''}">
        <video src="${bust(event.aftermovie)}" poster="${bust(event.aftermoviePoster)}" controls preload="none" playsinline></video>
      </div>
    `
    : '<p class="admin-note">No after movie yet.</p>';

  const tiles = photos.map((photo, i) => {
    const file = photo.src.split('/').pop();
    return `
      <div class="admin-photo${i < preview ? ' is-preview' : ''}" draggable="true" data-file="${file}">
        <img src="${bust(photo.thumb)}" alt="" draggable="false">
        <input type="checkbox" class="admin-photo__select" aria-label="Select photo ${i + 1}">
        <span class="admin-photo__num">${i + 1}</span>
      </div>
    `;
  }).join('');

  return `
    <details class="admin-item" data-key="gallery/${event.category}/${event.slug}" data-category="${event.category}" data-slug="${event.slug}">
      ${rowSummary(event, [
        badge(filmLabel, Boolean(event.aftermovie)),
        badge(`${photos.length} photos`, photos.length > 0),
        badge('Drive link', Boolean(event.driveLink)),
      ])}
      <div class="admin-item__body">
        <div class="admin-item__grid admin-item__grid--film">
          <div>
            <h3 class="admin-subtitle">After Movie</h3>
            ${film}
            <div class="admin-actions">
              <label class="btn btn--outline btn--small admin-file-btn">
                ${event.aftermovie ? 'Replace Film' : 'Upload Film'}
                <input type="file" accept="video/*" data-action="film" hidden>
              </label>
              ${event.aftermovie ? '<button type="button" class="btn btn--danger btn--small" data-action="remove-film">Remove Film</button>' : ''}
            </div>
            <p class="admin-note">Any format up to 2 GB, up to about 3 minutes long — compressed to web-ready video automatically (about a minute per minute of film). Widescreen and vertical both work. Big ProRes masters: export H.264, 1080p, 10–20 Mbps from Premiere first so they upload faster.</p>
          </div>

          <form class="drive-form admin-form">
            <h3 class="admin-subtitle">Full-Quality Photos</h3>
            <div class="field">
              <label>Google Drive Folder Link</label>
              <input type="url" name="driveLink" value="${escapeAttr(event.driveLink)}" placeholder="https://drive.google.com/drive/folders/...">
            </div>
            <p class="admin-note">Shows a "Download full-quality photos" link for this event. Make sure the folder is shared as "Anyone with the link".</p>
            <button type="submit" class="btn btn--solid btn--small">Save Link</button>
          </form>
        </div>

        <h3 class="admin-subtitle">Photos (${photos.length})</h3>
        ${photos.length ? `
          <p class="admin-note">Drag to reorder. The first ${preview} (highlighted) show in the preview grid next to the film; the rest are in "View all".</p>
          <div class="admin-photo-toolbar">
            <button type="button" class="btn btn--outline btn--small" data-action="select-all">Select All</button>
            <button type="button" class="btn btn--danger btn--small" data-action="delete-selected" disabled>Delete Selected</button>
            <button type="button" class="btn btn--solid btn--small" data-action="save-order" hidden>Save New Order</button>
          </div>
          <div class="admin-photo-grid">${tiles}</div>
        ` : '<p class="admin-note">No photos yet.</p>'}
        <div class="admin-actions">
          <label class="btn btn--outline btn--small admin-file-btn">
            Add Photos
            <input type="file" accept="image/*" multiple data-action="photos" hidden>
          </label>
          <a class="admin-link" href="gallery.html#${event.slug}" target="_blank" rel="noopener">View on gallery page &#8599;</a>
        </div>
        <p class="admin-note">Select up to 60 at a time, up to 30 MB each, any shape (iPhone HEIC works). They're resized for the web automatically — keep the full-quality originals in the Drive folder.</p>
      </div>
    </details>
  `;
}

function renderGalleryList() {
  const container = document.getElementById('gallery-admin-list');
  const keys = openKeys(container);
  const sorted = [...events].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  container.innerHTML = sorted.length
    ? sorted.map(renderGalleryEditor).join('')
    : '<p class="admin-note">Add an event first.</p>';
  restoreOpen(container, keys);
}

function updatePhotoToolbar(item) {
  const selected = item.querySelectorAll('.admin-photo__select:checked').length;
  const deleteBtn = item.querySelector('[data-action="delete-selected"]');
  if (deleteBtn) {
    deleteBtn.disabled = selected === 0;
    deleteBtn.textContent = selected ? `Delete Selected (${selected})` : 'Delete Selected';
  }
  const selectAll = item.querySelector('[data-action="select-all"]');
  const total = item.querySelectorAll('.admin-photo').length;
  if (selectAll) selectAll.textContent = selected === total && total ? 'Select None' : 'Select All';
}

function markOrderChanged(item) {
  const event = findEvent(item.dataset.category, item.dataset.slug);
  const preview = previewCount(event);
  item.querySelectorAll('.admin-photo').forEach((tile, i) => {
    tile.classList.toggle('is-preview', i < preview);
    tile.querySelector('.admin-photo__num').textContent = i + 1;
  });
  item.querySelector('[data-action="save-order"]').hidden = false;
}

function wirePhotoDragging(container) {
  let dragged = null;

  container.addEventListener('dragstart', (e) => {
    dragged = e.target.closest('.admin-photo');
    if (!dragged) return;
    dragged.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragover', (e) => {
    if (!dragged) return;
    const target = e.target.closest('.admin-photo');
    if (!target || target === dragged || target.parentElement !== dragged.parentElement) return;
    e.preventDefault();
    const rect = target.getBoundingClientRect();
    const after = e.clientX > rect.left + rect.width / 2;
    target.parentElement.insertBefore(dragged, after ? target.nextSibling : target);
  });

  container.addEventListener('dragend', () => {
    if (!dragged) return;
    dragged.classList.remove('is-dragging');
    markOrderChanged(dragged.closest('.admin-item'));
    dragged = null;
  });
}

function wireGalleryTab() {
  const container = document.getElementById('gallery-admin-list');
  wirePhotoDragging(container);

  container.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    const item = btn && btn.closest('.admin-item');
    if (!item) return;
    const event = findEvent(item.dataset.category, item.dataset.slug);

    try {
      if (btn.dataset.action === 'remove-film') {
        if (!confirm(`Remove the after movie from "${event.name}"?`)) return;
        await api('DELETE', `${apiBase(event)}/aftermovie`);
        await refresh('After movie removed.');
      } else if (btn.dataset.action === 'select-all') {
        const boxes = item.querySelectorAll('.admin-photo__select');
        const allChecked = Array.from(boxes).every((b) => b.checked);
        boxes.forEach((b) => { b.checked = !allChecked; });
        updatePhotoToolbar(item);
      } else if (btn.dataset.action === 'delete-selected') {
        const files = Array.from(item.querySelectorAll('.admin-photo__select:checked'))
          .map((b) => b.closest('.admin-photo').dataset.file);
        if (!confirm(`Delete ${files.length} photo${files.length === 1 ? '' : 's'} from "${event.name}"?`)) return;
        await api('POST', `${apiBase(event)}/gallery/delete`, { files });
        await refresh(`Deleted ${files.length} photo${files.length === 1 ? '' : 's'}.`);
      } else if (btn.dataset.action === 'save-order') {
        const files = Array.from(item.querySelectorAll('.admin-photo')).map((t) => t.dataset.file);
        await api('PUT', `${apiBase(event)}/gallery/order`, { files });
        await refresh('Photo order saved.');
      }
    } catch (err) {
      toast(err.message, true);
    }
  });

  container.addEventListener('change', async (e) => {
    const item = e.target.closest('.admin-item');
    if (!item) return;
    const event = findEvent(item.dataset.category, item.dataset.slug);

    if (e.target.classList.contains('admin-photo__select')) {
      e.target.closest('.admin-photo').classList.toggle('is-selected', e.target.checked);
      updatePhotoToolbar(item);
      return;
    }

    const action = e.target.dataset.action;
    const files = e.target.files;
    if (!files || !files.length || (action !== 'film' && action !== 'photos')) return;

    const data = new FormData();
    if (action === 'film') data.append('video', files[0]);
    else Array.from(files).forEach((f) => data.append('photos', f));

    try {
      const label = action === 'film' ? 'film' : `${files.length} photo${files.length === 1 ? '' : 's'}`;
      const result = await uploadWithProgress(`${apiBase(event)}/${action === 'film' ? 'aftermovie' : 'gallery'}`, data, (pct) => {
        toast(pct < 100
          ? `Uploading ${label}… ${pct}%`
          : (action === 'film' ? 'Compressing film… this takes a minute or two. Keep this page open.' : 'Resizing photos…'), false, true);
      });
      if (result.failed && result.failed.length) toast(`Couldn't read: ${result.failed.join(', ')}`, true);
      await refresh(action === 'film' ? 'After movie saved.' : `Added ${result.added} photo${result.added === 1 ? '' : 's'}.`);
    } catch (err) {
      toast(err.message, true);
    }
  });

  container.addEventListener('submit', async (e) => {
    const form = e.target;
    if (!form.classList.contains('drive-form')) return;
    e.preventDefault();
    const item = form.closest('.admin-item');
    const event = findEvent(item.dataset.category, item.dataset.slug);
    try {
      await api('PUT', apiBase(event), { driveLink: form.driveLink.value.trim() });
      await refresh('Drive link saved.');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ── Music tab ────────────────────────────────────────────────────────

function renderVideoRow(video) {
  return `
    <div class="admin-video-row">
      <span class="admin-video-row__featured">Featured</span>
      <div class="field" style="margin-bottom: 0;"><label>Title</label><input type="text" class="v-title" value="${escapeAttr(video.title)}"></div>
      <div class="field" style="margin-bottom: 0;"><label>YouTube Link</label><input type="text" class="v-url" value="${escapeAttr(video.youtubeUrl || '')}" placeholder="https://www.youtube.com/watch?v=..."></div>
      <div class="admin-lineup-item__order">
        <button type="button" class="admin-icon-btn" data-action="video-up" title="Move up">&#8593;</button>
        <button type="button" class="admin-icon-btn" data-action="video-down" title="Move down">&#8595;</button>
      </div>
      <button type="button" class="admin-icon-btn admin-icon-btn--danger" data-action="remove-video" title="Remove">&times;</button>
    </div>
  `;
}

async function loadVideos() {
  const videos = await api('GET', '/api/music/videos');
  document.getElementById('video-rows').innerHTML = videos.map(renderVideoRow).join('');
}

function wireMusicTab() {
  const rowsEl = document.getElementById('video-rows');

  rowsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const row = btn.closest('.admin-video-row');
    if (btn.dataset.action === 'remove-video') row.remove();
    if (btn.dataset.action === 'video-up' && row.previousElementSibling) rowsEl.insertBefore(row, row.previousElementSibling);
    if (btn.dataset.action === 'video-down' && row.nextElementSibling) rowsEl.insertBefore(row.nextElementSibling, row);
  });

  document.getElementById('add-video-row').addEventListener('click', () => {
    rowsEl.insertAdjacentHTML('beforeend', renderVideoRow({ title: '', youtubeUrl: '' }));
    rowsEl.lastElementChild.querySelector('.v-title').focus();
  });

  document.getElementById('save-videos').addEventListener('click', async () => {
    const videos = Array.from(rowsEl.querySelectorAll('.admin-video-row')).map((row) => ({
      title: row.querySelector('.v-title').value.trim(),
      youtubeId: null,
      youtubeUrl: row.querySelector('.v-url').value.trim() || '#',
    }));
    try {
      await api('PUT', '/api/music/videos', videos);
      toast('Videos saved.');
    } catch (err) {
      toast(err.message, true);
    }
  });

  const form = document.getElementById('soundcloud-form');
  let soundcloud = {};
  api('GET', '/api/music/soundcloud').then((data) => {
    soundcloud = data;
    form.playlistTitle.value = data.playlistTitle || '';
    form.embedUrl.value = data.embedUrl || '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('PUT', '/api/music/soundcloud', {
        ...soundcloud,
        playlistTitle: form.playlistTitle.value.trim(),
        embedUrl: form.embedUrl.value.trim() || null,
      });
      toast('SoundCloud saved.');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ── Site Settings tab ────────────────────────────────────────────────

const SEO_PAGES = [
  ['index.html', 'Home'],
  ['events.html', 'Events'],
  ['gallery.html', 'Gallery & After Movies'],
  ['music.html', 'Music'],
];

function renderSeoFields(seo) {
  return SEO_PAGES.map(([file, label]) => `
    <div class="admin-seo" data-page="${file}">
      <p class="admin-seo__page">${label}</p>
      <div class="field">
        <label>Title <span class="admin-count" data-max="60"></span></label>
        <input type="text" class="seo-title" value="${escapeAttr(seo[file].title)}">
      </div>
      <div class="field">
        <label>Description <span class="admin-count" data-max="160"></span></label>
        <textarea class="seo-description" rows="2">${escapeHtml(seo[file].description)}</textarea>
      </div>
    </div>
  `).join('');
}

function updateCounts(root) {
  root.querySelectorAll('.admin-count').forEach((el) => {
    const input = el.closest('.field').querySelector('input, textarea');
    const max = Number(el.dataset.max);
    el.textContent = `${input.value.length} / ${max}`;
    el.classList.toggle('is-over', input.value.length > max);
  });
}

function wireSettingsTab() {
  const form = document.getElementById('site-form');
  const seoEl = document.getElementById('seo-fields');

  api('GET', '/api/site').then((site) => {
    for (const el of form.elements) {
      if (el.name && typeof site[el.name] === 'string') el.value = site[el.name];
    }
    seoEl.innerHTML = renderSeoFields(site.seo);
    updateCounts(seoEl);
  });

  seoEl.addEventListener('input', () => updateCounts(seoEl));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    data.seo = {};
    seoEl.querySelectorAll('.admin-seo').forEach((block) => {
      data.seo[block.dataset.page] = {
        title: block.querySelector('.seo-title').value,
        description: block.querySelector('.seo-description').value,
      };
    });

    try {
      toast('Saving and rebuilding pages…', false, true);
      await api('PUT', '/api/site', data);
      toast('Settings saved — every page has been updated.');
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ── Init ──────────────────────────────────────────────────────────────

wireTabs();
wireEventsTab();
wireGalleryTab();
wireMusicTab();
wireSettingsTab();
loadEvents().catch((err) => toast(`Couldn't load events — is node server.js running? (${err.message})`, true));
loadVideos().catch(() => {});
