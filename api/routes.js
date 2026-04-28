// api/routes.js
// REST API endpoints your Expo app will call.
//
// Base URL (local dev): http://localhost:3001/api
// Base URL (deployed):  https://your-server.com/api

const express = require('express');
const router = express.Router();
const { db, dbHelpers, KNOWN_RETAILERS } = require('../db/database');
const { runAllScrapers } = require('../scheduler/scrapeRunner');

const SCRAPER_LABELS = {
  target: 'Target',
  walmart: 'Walmart',
  bestbuy: 'Best Buy',
  amazon: 'Amazon',
};

function productRowToApi(p) {
  return {
    id: p.id,
    name: p.name,
    game: p.game,
    search_term: p.search_term,
    enabled: p.enabled === 1,
    created_at: p.created_at,
  };
}

// ── GET /api/products ──────────────────────────────────────────────────────
// List all tracked products (includes `enabled` for dashboard toggles)
router.get('/products', (req, res) => {
  const products = dbHelpers.getAllProducts.all().map(productRowToApi);
  res.json({ success: true, data: products });
});

// ── PATCH /api/products/:productId ─────────────────────────────────────────
// Body: { enabled: true | false } — pause or resume scraping this product
router.patch('/products/:productId', (req, res) => {
  const id = parseInt(req.params.productId, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid product id' });
  }
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ success: false, error: 'enabled (boolean) is required' });
  }
  const result = dbHelpers.setProductEnabled.run(enabled ? 1 : 0, id);
  if (result.changes === 0) {
    return res.status(404).json({ success: false, error: 'Product not found' });
  }
  const row = dbHelpers.getProductById.get(id);
  res.json({ success: true, data: productRowToApi(row) });
});

// ── DELETE /api/products/:productId ────────────────────────────────────────
// Permanently remove a tracked product and its stock history
router.delete('/products/:productId', (req, res) => {
  const id = parseInt(req.params.productId, 10);
  if (Number.isNaN(id)) {
    return res.status(400).json({ success: false, error: 'Invalid product id' });
  }
  const result = dbHelpers.deleteProductById(id);
  if (result.changes === 0) {
    return res.status(404).json({ success: false, error: 'Product not found' });
  }
  res.json({ success: true, message: 'Product removed' });
});

// ── POST /api/products ─────────────────────────────────────────────────────
// Add a new product to track
// Body: { name, game, search_term }
router.post('/products', (req, res) => {
  const { name, game, search_term } = req.body;
  if (!name || !game || !search_term) {
    return res.status(400).json({ success: false, error: 'name, game, and search_term are required' });
  }
  const result = dbHelpers.addProduct.run(name, game, search_term);
  const row = dbHelpers.getProductById.get(result.lastInsertRowid);
  res.json({ success: true, data: productRowToApi(row) });
});

// ── GET /api/stock ─────────────────────────────────────────────────────────
// Get all currently in-stock items (last 3 hours)
// Optional query params: ?game=pokemon
router.get('/stock', (req, res) => {
  const { game } = req.query;

  let results = dbHelpers.getAllInStock.all();

  if (game) {
    results = results.filter(r => r.game === game.toLowerCase());
  }

  res.json({ success: true, data: results, count: results.length });
});

// ── DELETE /api/stock ──────────────────────────────────────────────────────
// Remove all stock check rows (dashboard "clear results"; tracked products unchanged)
router.delete('/stock', (req, res) => {
  const result = dbHelpers.clearAllStockResults.run();
  res.json({
    success: true,
    deleted: result.changes,
    message: 'All stock results cleared',
  });
});

// ── GET /api/stock/:productId ──────────────────────────────────────────────
// Get latest stock status for a specific product across all retailers
router.get('/stock/:productId', (req, res) => {
  const { productId } = req.params;
  const results = dbHelpers.getLatestStockForProduct.all(productId);

  if (!results.length) {
    return res.json({ success: true, data: [], message: 'No stock data yet — run a scrape first' });
  }

  res.json({ success: true, data: results });
});

// ── GET /api/stock/summary ─────────────────────────────────────────────────
// Summary view — grouped by game, which products are in stock where
router.get('/stock/view/summary', (req, res) => {
  const rows = db.prepare(`
    SELECT
      p.game,
      COALESCE(NULLIF(TRIM(sr.scraped_product_name), ''), p.name) as name,
      p.id as product_id,
      sr.retailer,
      sr.store_type,
      sr.in_stock,
      sr.price,
      sr.url,
      sr.checked_at
    FROM stock_results sr
    JOIN products p ON p.id = sr.product_id
    WHERE sr.checked_at >= datetime('now', '-3 hours')
    AND p.enabled = 1
    ORDER BY p.game, p.name, sr.retailer
  `).all();

  // Group by game → product → retailer
  const summary = {};
  for (const row of rows) {
    if (!summary[row.game]) summary[row.game] = {};
    if (!summary[row.game][row.name]) summary[row.game][row.name] = [];
    summary[row.game][row.name].push({
      retailer: row.retailer,
      storeType: row.store_type,
      inStock: row.in_stock === 1,
      price: row.price,
      url: row.url,
      checkedAt: row.checked_at,
    });
  }

  res.json({ success: true, data: summary });
});

// ── POST /api/register-token ───────────────────────────────────────────────
// Register an Expo push token from the app
// Body: { token, zip_code, games: ["pokemon", "onepiece"] }
router.post('/register-token', (req, res) => {
  const { token, zip_code, games } = req.body;
  if (!token) return res.status(400).json({ success: false, error: 'token is required' });

  dbHelpers.registerToken.run(token, zip_code || null, JSON.stringify(games || []));
  res.json({ success: true, message: 'Token registered' });
});

// ── GET /api/scrapers ──────────────────────────────────────────────────────
// List retailers and whether each scraper is enabled (dashboard toggles)
router.get('/scrapers', (req, res) => {
  const rows = dbHelpers.getScraperSettings.all();
  const data = rows.map(r => ({
    key: r.retailer,
    label: SCRAPER_LABELS[r.retailer] || r.retailer,
    enabled: r.enabled === 1,
  }));
  res.json({ success: true, data });
});

// ── PATCH /api/scrapers ──────────────────────────────────────────────────────
// Body: { "target": true, "walmart": false, ... } — only known retailer keys apply
router.patch('/scrapers', (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const allowed = new Set(KNOWN_RETAILERS);
  let updated = 0;

  for (const [key, val] of Object.entries(body)) {
    if (!allowed.has(key) || typeof val !== 'boolean') continue;
    dbHelpers.setScraperEnabled.run(val ? 1 : 0, key);
    updated++;
  }

  const rows = dbHelpers.getScraperSettings.all();
  const data = rows.map(r => ({
    key: r.retailer,
    label: SCRAPER_LABELS[r.retailer] || r.retailer,
    enabled: r.enabled === 1,
  }));

  res.json({
    success: true,
    updated,
    data,
    message: updated ? 'Settings saved' : 'No valid fields to update',
  });
});

// ── POST /api/scrape/run ───────────────────────────────────────────────────
// Manually trigger a scrape run (useful for testing, or a "refresh" button in app)
// Add a secret key check before exposing this publicly
router.post('/scrape/run', async (req, res) => {
  // Optional: protect with a simple secret
  const { secret } = req.body;
  if (process.env.SCRAPE_SECRET && secret !== process.env.SCRAPE_SECRET) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  // Run async — don't block the HTTP response
  res.json({ success: true, message: 'Scrape started — check back in a few minutes' });

  try {
    await runAllScrapers();
  } catch (err) {
    console.error('[API] Manual scrape failed:', err);
  }
});

// ── GET /api/logs ──────────────────────────────────────────────────────────
// See recent scrape history
router.get('/logs', (req, res) => {
  const logs = db.prepare(`
    SELECT * FROM scrape_log ORDER BY ran_at DESC LIMIT 50
  `).all();
  res.json({ success: true, data: logs });
});

// ── GET /api/health ────────────────────────────────────────────────────────
// Health check endpoint
router.get('/health', (req, res) => {
  const productCount = db.prepare('SELECT COUNT(*) as count FROM products').get();
  const enabledCount = db.prepare('SELECT COUNT(*) as count FROM products WHERE enabled = 1').get();
  const lastScrape = db.prepare('SELECT ran_at FROM scrape_log ORDER BY ran_at DESC LIMIT 1').get();
  res.json({
    status: 'ok',
    products_tracked: productCount.count,
    products_enabled_for_scrape: enabledCount.count,
    last_scrape: lastScrape?.ran_at || 'never',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
