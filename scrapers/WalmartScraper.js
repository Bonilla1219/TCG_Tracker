// scrapers/WalmartScraper.js
// Scrapes Walmart for TCG card availability.
//
// Strategy: Walmart's site renders stock info in the page HTML.
// We search, grab the first result, then check availability text.

const { BaseScraper, StockResult } = require('./BaseScraper');

class WalmartScraper extends BaseScraper {
  constructor() {
    super('Walmart');
  }

  async scrape(product, zipCode) {
    const results = [];
    await this.launch();

    try {
      const page = await this.newPage();

      // ── Step 1: Search Walmart ───────────────────────────────────────
      const searchUrl = `https://www.walmart.com/search?q=${encodeURIComponent(product.search_term)}`;
      console.log(`[Walmart] Searching: ${product.search_term}`);

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      await this.sleep(2500); // Walmart is slow to render

      // ── Step 2: Get first product link ───────────────────────────────
      let productUrl = null;
      try {
        // Walmart search results wrap products in `[data-item-id]` containers
        const firstLink = await page
          .locator('a[link-identifier="itemLink"]')
          .first()
          .getAttribute('href');

        productUrl = firstLink?.startsWith('http')
          ? firstLink
          : 'https://www.walmart.com' + firstLink;
      } catch (e) {
        console.warn('[Walmart] Could not find first result link');
      }

      if (!productUrl) {
        results.push(new StockResult({
          productId: product.id,
          retailer: 'walmart',
          inStock: false,
          storeType: 'online',
          zipCode,
        }));
        return results;
      }

      // ── Step 3: Check product page ───────────────────────────────────
      await page.goto(productUrl, { waitUntil: 'domcontentloaded' });
      await this.sleep(2000);

      let onlineInStock = false;
      let price = null;

      // Walmart shows "Add to cart" or "Out of stock" button
      try {
        // Out of stock button has text "Get in-stock alert" or "Out of stock"
        const outOfStockEl = await page.locator('text=Out of stock, text=Get in-stock alert').count();
        onlineInStock = outOfStockEl === 0;

        // Double-check: if "Add to cart" button exists, definitely in stock
        const addToCart = await page.locator('button[data-automation-id="add-to-cart"]').count();
        if (addToCart > 0) onlineInStock = true;
      } catch (e) {}

      // Get price
      try {
        const priceEl = await page
          .locator('[itemprop="price"], [data-automation="buybox-price"]')
          .first()
          .textContent();
        price = priceEl?.trim();
      } catch (e) {}

      results.push(new StockResult({
        productId: product.id,
        retailer: 'walmart',
        inStock: onlineInStock,
        price,
        url: productUrl,
        storeType: 'online',
        zipCode,
      }));

      console.log(`[Walmart] Online stock for "${product.name}": ${onlineInStock ? '✅ IN STOCK' : '❌ Out of stock'} ${price || ''}`);

      // ── Step 4: In-store availability ────────────────────────────────
      if (zipCode) {
        try {
          // Walmart shows "Pickup" section on product page
          const pickupText = await page
            .locator('[data-automation="fulfillment-pickup"]')
            .first()
            .textContent()
            .catch(() => '');

          const inStoreInStock =
            pickupText.toLowerCase().includes('pickup today') ||
            pickupText.toLowerCase().includes('ready today') ||
            pickupText.toLowerCase().includes('free pickup');

          results.push(new StockResult({
            productId: product.id,
            retailer: 'walmart',
            inStock: inStoreInStock,
            price,
            url: productUrl,
            storeType: 'in_store',
            zipCode,
          }));

          console.log(`[Walmart] In-store stock for "${product.name}": ${inStoreInStock ? '✅ IN STOCK' : '❌ Out of stock'}`);
        } catch (e) {
          console.warn('[Walmart] Could not check in-store availability');
        }
      }

    } catch (err) {
      console.error(`[Walmart] Error scraping "${product.name}":`, err.message);
    } finally {
      await this.close();
    }

    return results;
  }
}

module.exports = WalmartScraper;
