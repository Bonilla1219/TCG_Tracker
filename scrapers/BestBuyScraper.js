// scrapers/BestBuyScraper.js
// Scrapes Best Buy for TCG card availability.
//
// Best Buy is one of the friendlier sites to scrape — stock status
// is rendered in the HTML and their search is straightforward.

const { BaseScraper, StockResult } = require('./BaseScraper');

class BestBuyScraper extends BaseScraper {
  constructor() {
    super('BestBuy');
  }

  async scrape(product, zipCode) {
    const results = [];
    await this.launch();

    try {
      const page = await this.newPage();

      // ── Step 1: Search Best Buy ──────────────────────────────────────
      const searchUrl = `https://www.bestbuy.com/site/searchpage.jsp?st=${encodeURIComponent(product.search_term)}`;
      console.log(`[BestBuy] Searching: ${product.search_term}`);

      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      await this.sleep(2000);

      // ── Step 2: Check stock directly from search results ─────────────
      // Best Buy search results actually show "Add to Cart" or "Sold Out" right on the list
      // So we can check multiple results at once without clicking into each product

      const productCards = await page.locator('.sku-item').all();
      console.log(`[BestBuy] Found ${productCards.length} results`);

      for (const card of productCards.slice(0, 3)) { // Check top 3 results
        try {
          const title = await card.locator('.sku-title a').textContent().catch(() => '');
          const productLink = await card.locator('.sku-title a').getAttribute('href').catch(() => null);
          const fullUrl = productLink
            ? (productLink.startsWith('http') ? productLink : 'https://www.bestbuy.com' + productLink)
            : null;

          // "Add to Cart" button = in stock; "Sold Out" button = not
          const buttonText = await card.locator('.add-to-cart-button').textContent().catch(() => 'Sold Out');
          const onlineInStock = buttonText.toLowerCase().includes('add to cart');

          // Price
          const priceText = await card.locator('.priceView-customer-price span').first().textContent().catch(() => null);

          results.push(new StockResult({
            productId: product.id,
            retailer: 'bestbuy',
            inStock: onlineInStock,
            price: priceText?.trim(),
            url: fullUrl,
            storeType: 'online',
            zipCode,
          }));

          console.log(`[BestBuy] "${title?.trim()?.slice(0, 50)}": ${onlineInStock ? '✅ IN STOCK' : '❌ Out of stock'}`);

          // Only need one in-stock result per product
          if (onlineInStock) break;

        } catch (e) {
          console.warn('[BestBuy] Error reading a product card:', e.message);
        }
      }

      // If no results found at all
      if (results.length === 0) {
        results.push(new StockResult({
          productId: product.id,
          retailer: 'bestbuy',
          inStock: false,
          storeType: 'online',
          zipCode,
        }));
      }

    } catch (err) {
      console.error(`[BestBuy] Error scraping "${product.name}":`, err.message);
    } finally {
      await this.close();
    }

    return results;
  }
}

module.exports = BestBuyScraper;
