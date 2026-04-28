// scrapers/AmazonScraper.js
// Scrapes Amazon for TCG card availability.
//
// ⚠️  NOTE: Amazon is the HARDEST to scrape reliably.
// They aggressively block bots. This scraper works but may get CAPTCHAs.
// If Amazon becomes unreliable, consider using their official Product
// Advertising API instead (requires approval but is much more stable).
//
// Strategy: Search Amazon, check the first result for availability.

const { BaseScraper, StockResult } = require('./BaseScraper');

class AmazonScraper extends BaseScraper {
  constructor() {
    super('Amazon');
  }

  async scrape(product, zipCode) {
    const results = [];
    await this.launch();

    try {
      const page = await this.newPage();

      // ── Step 1: Search Amazon ────────────────────────────────────────
      const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(product.search_term)}&i=toys-and-games`;
      console.log(`[Amazon] Searching: ${product.search_term}`);

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      await this.sleep(2500);

      // Check if we hit a CAPTCHA
      const pageContent = await page.content();
      if (pageContent.includes('robot') || pageContent.includes('captcha')) {
        console.warn('[Amazon] ⚠️  Hit bot detection — skipping Amazon for now');
        results.push(new StockResult({
          productId: product.id,
          retailer: 'amazon',
          inStock: false,
          storeType: 'online',
          zipCode,
        }));
        return results;
      }

      // ── Step 2: Get first result ─────────────────────────────────────
      let productUrl = null;
      try {
        const firstResult = await page
          .locator('div[data-component-type="s-search-result"] h2 a')
          .first()
          .getAttribute('href');

        productUrl = firstResult?.startsWith('http')
          ? firstResult
          : 'https://www.amazon.com' + firstResult;
      } catch (e) {}

      if (!productUrl) {
        results.push(new StockResult({
          productId: product.id,
          retailer: 'amazon',
          inStock: false,
          storeType: 'online',
          zipCode,
        }));
        return results;
      }

      // ── Step 3: Product page stock check ────────────────────────────
      await page.goto(productUrl, { waitUntil: 'domcontentloaded' });
      await this.sleep(2000);

      let inStock = false;
      let price = null;

      // Amazon's availability text is in #availability
      try {
        const availabilityText = await page
          .locator('#availability span')
          .first()
          .textContent();
        inStock = availabilityText.toLowerCase().includes('in stock');
      } catch (e) {
        // Fall back: if "Add to Cart" button exists, it's in stock
        try {
          const addToCart = await page.locator('#add-to-cart-button').count();
          inStock = addToCart > 0;
        } catch (e2) {}
      }

      // Get price
      try {
        const priceWhole = await page.locator('.a-price-whole').first().textContent();
        const priceFraction = await page.locator('.a-price-fraction').first().textContent();
        price = `$${priceWhole?.trim()}${priceFraction?.trim()}`;
      } catch (e) {}

      results.push(new StockResult({
        productId: product.id,
        retailer: 'amazon',
        inStock,
        price,
        url: productUrl,
        storeType: 'online',
        zipCode,
      }));

      console.log(`[Amazon] Online stock for "${product.name}": ${inStock ? '✅ IN STOCK' : '❌ Out of stock'} ${price || ''}`);

    } catch (err) {
      console.error(`[Amazon] Error scraping "${product.name}":`, err.message);
    } finally {
      await this.close();
    }

    return results;
  }
}

module.exports = AmazonScraper;
