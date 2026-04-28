// scrapers/TargetScraper.js
// Scrapes Target for TCG card availability (online + in-store).
//
// Strategy: Target's site is React-rendered. We search their site,
// then check the product page for "Add to cart" vs "Out of stock".
// For in-store stock, we hit their store pickup API.

const { BaseScraper, StockResult } = require('./BaseScraper');

/** How many search-result tiles to open (top N by Target's ranking). */
const MAX_SEARCH_RESULTS = 3;

/** How many times to reload when Target shows its block page. */
const MAX_RETRIES = 3;

class TargetScraper extends BaseScraper {
  constructor() {
    super('Target');
  }

  /**
   * Detect Target's "currently unavailable" block page and retry with reload.
   * Returns true if the page loaded successfully, false if all retries failed.
   */
  async waitForRealPage(page, label) {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const body = await page.locator('body').textContent().catch(() => '');
      const blocked =
        body.includes('currently unavailable') ||
        body.includes("We're sorry") ||
        body.includes('Access Denied');

      if (!blocked) return true;

      console.warn(
        `[Target] Blocked on ${label} (attempt ${attempt}/${MAX_RETRIES}) — reloading...`
      );
      await this.sleep(2000 + Math.random() * 3000);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await this.sleep(3000);
    }

    console.error(`[Target] Still blocked on ${label} after ${MAX_RETRIES} retries`);
    return false;
  }

  /**
   * Collect up to `MAX_SEARCH_RESULTS` unique product URLs from the search results page.
   */
  async collectTopProductUrls(page) {
    const seen = new Set();
    const urls = [];
    const linkLocator = page.locator(
      '[data-test="product-title"] a, [data-test="@web/ProductCard/ProductCardImageHoverableLink"] a'
    );
    const n = await linkLocator.count();

    for (let i = 0; i < n && urls.length < MAX_SEARCH_RESULTS; i++) {
      let href = await linkLocator.nth(i).getAttribute('href');
      if (!href) continue;
      if (!href.startsWith('http')) {
        href = 'https://www.target.com' + href;
      }
      if (seen.has(href)) continue;
      seen.add(href);
      urls.push(href);
    }

    return urls;
  }

  /** Title text from Target's product detail page (search hit we opened). */
  async readTargetProductTitle(page) {
    try {
      const t = await page.locator('[data-test="product-title"]').first().textContent();
      const s = t?.trim();
      if (s) return s;
    } catch (e) {}
    try {
      const t = await page.locator('h1').first().textContent();
      const s = t?.trim();
      if (s) return s;
    } catch (e) {}
    return null;
  }

  /**
   * Visit one PDP and append online (+ optional in-store) StockResults.
   */
  async checkProductPage(page, productUrl, product, zipCode, results, resultIndex) {
    await page.goto(productUrl, { waitUntil: 'domcontentloaded' });
    await this.sleep(2000);

    const pdpLoaded = await this.waitForRealPage(page, productUrl);

    let scrapedName = null;
    if (pdpLoaded) {
      scrapedName = await this.readTargetProductTitle(page);
    }

    let onlineInStock = false;
    let price = null;

    if (!pdpLoaded) {
      console.warn(`[Target] Skipping blocked PDP: ${productUrl}`);
    }

    try {
      const addToCart = page.locator('[data-test="orderPickupButton"], [data-test="shipItButton"], [data-test="shippingButton"]').first();
      const isDisabled = await addToCart.isDisabled().catch(() => true);
      onlineInStock = !isDisabled;
    } catch (e) {
      console.error("error checking link:", e);
      // Couldn't determine — assume out of stock
    }

    try {
      const priceEl = await page.locator('[data-test="product-price"]').first().textContent();
      price = priceEl?.trim();
    } catch (e) {}

    const label = resultIndex != null ? `#${resultIndex + 1}` : '';
    results.push(
      new StockResult({
        productId: product.id,
        retailer: 'target',
        inStock: onlineInStock,
        price,
        url: productUrl,
        storeType: 'online',
        zipCode,
        scrapedProductName: scrapedName,
      })
    );

    const displayName = scrapedName || product.name;
    console.log(
      `[Target] Online ${label} for "${displayName}": ${onlineInStock ? '✅ IN STOCK' : '❌ Out of stock'} ${price || ''}`
    );

    if (zipCode) {
      try {
        const checkStores = page.locator('text=Check stores, text=Store pickup').first();
        await checkStores.click({ timeout: 5000 }).catch(() => {});
        await this.sleep(1500);

        const storeStockText = await page
          .locator('[data-test="store-availability"]')
          .first()
          .textContent()
          .catch(() => '');

        const inStoreInStock =
          storeStockText.toLowerCase().includes('in stock') ||
          storeStockText.toLowerCase().includes('pick up');

        results.push(
          new StockResult({
            productId: product.id,
            retailer: 'target',
            inStock: inStoreInStock,
            price,
            url: productUrl,
            storeType: 'in_store',
            zipCode,
            scrapedProductName: scrapedName,
          })
        );

        console.log(
          `[Target] In-store ${label} for "${displayName}": ${inStoreInStock ? '✅ IN STOCK' : '❌ Out of stock'}`
        );
      } catch (e) {
        console.warn('[Target] Could not check in-store availability');
      }
    }
  }

  async scrape(product, zipCode) {
    const results = [];
    await this.launch();

    try {
      const page = await this.newPage();

      // ── Step 1: Search Target ────────────────────────────────────────
      const searchUrl = `https://www.target.com/s?searchTerm=${encodeURIComponent(product.search_term)}`;
      console.log(`[Target] Searching: ${product.search_term}`);
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });
      await this.sleep(2000);

      const searchLoaded = await this.waitForRealPage(page, 'search results');

      // ── Step 2: Grab up to first N unique product links ────────────────
      let productUrls = [];
      if (searchLoaded) {
        try {
          productUrls = await this.collectTopProductUrls(page);
        } catch (e) {
          console.warn('[Target] Could not read search results');
        }
      }

      if (productUrls.length === 0) {
        results.push(
          new StockResult({
            productId: product.id,
            retailer: 'target',
            inStock: false,
            storeType: 'online',
            zipCode,
          })
        );
        return results;
      }

      // ── Step 3–4: Check each result's PDP (online + in-store) ────────
      for (let i = 0; i < productUrls.length; i++) {
        try {
          await this.checkProductPage(page, productUrls[i], product, zipCode, results, i);
        } catch (e) {
          console.warn(`[Target] Result #${i + 1} failed (${productUrls[i]}):`, e.message);
        }
      }
    } catch (err) {
      console.error(`[Target] Error scraping "${product.name}":`, err.message);
    } finally {
      await this.close();
    }

    return results;
  }
}

module.exports = TargetScraper;
