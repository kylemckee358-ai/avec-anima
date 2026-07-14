const SITE_VERSION = '1.0.4';

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.footer__copy').forEach((el) => {
    el.textContent = `${el.textContent.trim()} · v${SITE_VERSION}`;
  });
});
