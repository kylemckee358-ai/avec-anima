const SHOPIFY_STORE_URL = 'https://kp1kgw-bb.myshopify.com';

async function loadMerch() {
  const grid = document.getElementById('home-merch-grid');
  if (!grid) return;

  try {
    const res = await fetch(`${SHOPIFY_STORE_URL}/products.json?limit=3`);
    if (!res.ok) throw new Error(`Shopify products request failed: ${res.status}`);

    const data = await res.json();
    const products = (data.products || []).slice(0, 3);
    if (!products.length) throw new Error('No products returned');

    grid.innerHTML = products
      .map((product) => {
        const image = product.images && product.images[0] ? product.images[0].src : '';
        const price = product.variants && product.variants[0] ? product.variants[0].price : null;
        const url = `${SHOPIFY_STORE_URL}/products/${product.handle}`;

        return `
          <a class="merch-card" href="${url}">
            <div class="merch-card__image">
              ${image ? `<img src="${image}" alt="${product.title}" loading="lazy">` : ''}
            </div>
            <div class="merch-card__title">${product.title}</div>
            ${price ? `<div class="merch-card__price">&pound;${price}</div>` : ''}
          </a>
        `;
      })
      .join('');
  } catch (err) {
    grid.innerHTML = '<p class="events-empty">Merch coming soon &mdash; check back shortly.</p>';
  }
}

loadMerch();
