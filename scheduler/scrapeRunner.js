// scheduler/scrapeRunner.js
// This is the main orchestrator. It:
//   1. Loads all products from the DB
//   2. Runs each scraper for each product
//   3. Saves results to the DB
//   4. Logs success/failure
//
// Called by the cron scheduler AND can be run manually.

const { db, dbHelpers } = require('../db/database');
const { sendStockAlerts } = require('../utils/pushNotifications');
const TargetScraper  = require('../scrapers/TargetScraper');
const WalmartScraper = require('../scrapers/WalmartScraper');
const BestBuyScraper = require('../scrapers/BestBuyScraper');
const AmazonScraper  = require('../scrapers/AmazonScraper');

require('dotenv').config();

const ZIP_CODE = process.env.DEFAULT_ZIP_CODE || '90210';

// Registry: `key` must match `stock_results.retailer` and `scraper_settings.retailer`
const SCRAPER_REGISTRY = [
  { key: 'target', scraper: new TargetScraper() },
  { key: 'walmart', scraper: new WalmartScraper() },
  { key: 'bestbuy', scraper: new BestBuyScraper() },
  { key: 'amazon', scraper: new AmazonScraper() },
];

function getActiveScrapers() {
  const rows = dbHelpers.getScraperSettings.all();
  const enabled = new Set(rows.filter(r => r.enabled === 1).map(r => r.retailer));
  return SCRAPER_REGISTRY.filter(({ key }) => enabled.has(key));
}

async function runAllScrapers() {
  console.log(`
═══════════════════════════════════════════`);
  console.log(`🃏 TCG Tracker — Scrape run started`);
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════\n');

  const scrapers = getActiveScrapers();
  const products = dbHelpers.getEnabledProducts.all();

  if (scrapers.length === 0) {
    console.log('⚠️  No retailers enabled — enable at least one in the dashboard (scraper_settings).\n');
    return { totalChecked: 0, totalInStock: 0 };
  }

  if (products.length === 0) {
    console.log('⚠️  No products enabled for scraping — turn products on in the dashboard.\n');
    return { totalChecked: 0, totalInStock: 0 };
  }

  console.log(`📦 Scraping ${products.length} product(s) across ${scrapers.length} retailer(s)\n`);

  let totalInStock = 0;
  let totalChecked = 0;

  for (const { scraper } of scrapers) {
    console.log(`\n──── ${scraper.name} ─────────────────────────`);

    for (const product of products) {
      try {
        const results = await scraper.scrape(product, ZIP_CODE);

        for (const result of results) {
          dbHelpers.insertStockResult.run(
            result.productId,
            result.retailer,
            result.inStock,
            result.price,
            result.url,
            result.storeType,
            result.zipCode,
            result.scrapedProductName ?? null,
          );
          totalChecked++;
          if (result.inStock) totalInStock++;
        }

        dbHelpers.logScrape.run(scraper.name.toLowerCase(), 'success', `Scraped "${product.name}"`);

        // Polite delay between products on same retailer (avoid rate limiting)
        await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));

      } catch (err) {
        console.error(`[${scraper.name}] Failed on "${product.name}":`, err.message);
        dbHelpers.logScrape.run(scraper.name.toLowerCase(), 'error', err.message);
      }
    }

    // Longer delay between retailers
    await new Promise(r => setTimeout(r, 3000));
  }

  // Send push notifications for newly in-stock items
  const inStockResults = dbHelpers.getAllInStock.all();
  await sendStockAlerts(inStockResults);

  console.log(`
═══════════════════════════════════════════`);
  console.log(`✅ Scrape run complete`);
  console.log(`   Checked: ${totalChecked} stock entries`);
  console.log(`   In stock: ${totalInStock}`);
  console.log(`   Time: ${new Date().toISOString()}`);
  console.log('═══════════════════════════════════════════\n');

  return { totalChecked, totalInStock };
}

module.exports = { runAllScrapers, getActiveScrapers, SCRAPER_REGISTRY };
