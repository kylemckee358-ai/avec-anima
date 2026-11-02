// Artist tiles — clicking an artist (lineup names on the home, events and event pages; guest cards
// on the About page) opens a tile with their photo, details and the nights they've played, right
// where you are. The tiles are built by lib/seo.js into assets/about/artists.json.
// Without JavaScript (or for an artist with no tile) the links still go to the About page.

(function () {
  if (typeof HTMLDialogElement !== 'function') return; // very old browsers: links work as normal

  const onAboutPage = /about\.html$/.test(window.location.pathname);
  let tiles = null;

  function loadTiles() {
    if (!tiles) {
      tiles = fetch('assets/about/artists.json', { cache: 'no-cache' })
        .then((res) => (res.ok ? res.json() : {}))
        .catch(() => ({}));
    }
    return tiles;
  }

  let dialog = null;
  function getDialog() {
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'guest-dialog';
    dialog.setAttribute('aria-label', 'Artist');
    dialog.innerHTML = '<button type="button" class="guest-dialog__close" aria-label="Close">&times;</button><div class="guest-dialog__content"></div>';
    dialog.querySelector('.guest-dialog__close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // click outside the tile
    dialog.addEventListener('close', () => {
      if (onAboutPage) history.replaceState(null, '', window.location.pathname + window.location.search);
    });
    document.body.appendChild(dialog);
    return dialog;
  }

  // Resolves false if there's no tile for this artist, so the caller can follow the link instead
  async function open(slug) {
    const html = (await loadTiles())[slug];
    if (!html) return false;
    const d = getDialog();
    d.querySelector('.guest-dialog__content').innerHTML = html;
    // Already on the About page — the "More on the About page" link isn't needed
    if (onAboutPage) d.querySelector('.guest-detail__more')?.remove();
    if (!d.open) d.showModal();
    if (onAboutPage) history.replaceState(null, '', `#artist-${slug}`);
    return true;
  }

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const guestCard = e.target.closest('.guest__open[data-artist]');
    const link = !guestCard && e.target.closest('a[href*="about.html#artist-"]');
    if (!guestCard && !link) return;
    // Inside an open tile, "More on the About page" is a normal link
    if (link && link.classList.contains('guest-detail__more')) return;

    const slug = guestCard ? guestCard.dataset.artist : link.getAttribute('href').split('#artist-')[1];
    e.preventDefault();
    open(slug).then((opened) => {
      if (!opened && link) window.location.href = link.href;
    });
  });

  // Arriving on the About page from a link to a guest opens their tile
  if (onAboutPage && window.location.hash.startsWith('#artist-')) {
    const target = document.getElementById(window.location.hash.slice(1));
    if (target && target.classList.contains('guest')) open(target.id.slice('artist-'.length));
  }
})();
