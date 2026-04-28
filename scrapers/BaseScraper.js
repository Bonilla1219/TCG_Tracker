// scrapers/BaseScraper.js
// All retailer scrapers extend this class.

const { chromium } = require('playwright');

class BaseScraper {
  constructor(name) {
    this.name = name;
    this.browser = null;
    this.context = null;
  }

  // ── Browser lifecycle ──────────────────────────────────────────────────

  async launch() {
    this.browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    this.context = await this.browser.newContext({
      // Spoof a real user agent so sites don't immediately block us
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
      // Block images/fonts to speed up scraping
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    // Block heavy assets we don't need
    await this.context.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf}', route =>
      route.abort()
    );

    console.log(`[${this.name}] Browser launched`);
  }

  async close() {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.context = null;
    }
  }

  async newPage() {
    const page = await this.context.newPage();
    // Random delay between actions to appear more human
    page.setDefaultTimeout(30000);
    return page;
  }

  // ── Utility helpers ────────────────────────────────────────────────────

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms + Math.random() * 500));
  }

  // Subclasses implement this — returns array of StockResult objects
  async scrape(product, zipCode) {
    throw new Error(`${this.name}.scrape() not implemented`);
  }
}

// ── StockResult shape ──────────────────────────────────────────────────────
// Every scraper returns objects in this format.

class StockResult {
  constructor({ productId, retailer, inStock, price, url, storeType, zipCode, scrapedProductName }) {
    this.productId = productId;
    this.retailer  = retailer;
    this.inStock   = inStock ? 1 : 0;
    this.price     = price || null;
    this.url       = url || null;
    this.storeType = storeType; // 'online' or 'in_store'
    this.zipCode   = zipCode || null;
    this.scrapedProductName = scrapedProductName?.trim() || null;
  }
}

module.exports = { BaseScraper, StockResult };
