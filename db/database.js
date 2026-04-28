// db/database.js
// Uses SQLite via better-sqlite3 — no external DB needed to get started.
// Drop-in replace with Postgres later if you scale up.

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '../data/tcg_tracker.db');

// Ensure data directory exists
const fs = require('fs');
fs.mkdirSync(path.join(__dirname, '../data'), { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// ─── Schema ────────────────────────────────────────────────────────────────

db.exec(`
  -- Cards/products we're tracking
  CREATE TABLE IF NOT EXISTS products (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    game        TEXT NOT NULL,  -- 'pokemon', 'onepiece', 'yugioh', etc.
    search_term TEXT NOT NULL,  -- what we search for on retailer sites
    enabled     INTEGER NOT NULL DEFAULT 1, -- 0 = skip in scrapes / alerts
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Every stock check result goes here
  CREATE TABLE IF NOT EXISTS stock_results (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id  INTEGER NOT NULL,
    retailer    TEXT NOT NULL,   -- 'target', 'walmart', 'amazon', 'bestbuy'
    in_stock    INTEGER NOT NULL, -- 1 = in stock, 0 = out of stock
    price       TEXT,
    url         TEXT,
    store_type  TEXT,            -- 'online' or 'in_store'
    zip_code    TEXT,            -- for in-store checks
    checked_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );

  -- Track when we last scraped each retailer
  CREATE TABLE IF NOT EXISTS scrape_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    retailer    TEXT NOT NULL,
    status      TEXT NOT NULL,  -- 'success', 'error', 'blocked'
    message     TEXT,
    ran_at      DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Expo push tokens for sending alerts to users
  CREATE TABLE IF NOT EXISTS push_tokens (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    token       TEXT UNIQUE NOT NULL,
    zip_code    TEXT,
    games       TEXT,           -- JSON array: ["pokemon","onepiece"]
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Which retailer scrapers are enabled (dashboard + scrape runs)
  CREATE TABLE IF NOT EXISTS scraper_settings (
    retailer TEXT PRIMARY KEY,
    enabled  INTEGER NOT NULL DEFAULT 1
  );
`);

{
  const productCols = db.prepare(`PRAGMA table_info(products)`).all();
  if (!productCols.some(c => c.name === 'enabled')) {
    db.exec(`ALTER TABLE products ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1`);
    console.log('[DB] Added products.enabled column');
  }
}

{
  const srCols = db.prepare(`PRAGMA table_info(stock_results)`).all();
  if (!srCols.some(c => c.name === 'scraped_product_name')) {
    db.exec(`ALTER TABLE stock_results ADD COLUMN scraped_product_name TEXT`);
    console.log('[DB] Added stock_results.scraped_product_name column');
  }
}

const KNOWN_RETAILERS = ['target', 'walmart', 'bestbuy', 'amazon'];
const insertScraperDefault = db.prepare(
  'INSERT OR IGNORE INTO scraper_settings (retailer, enabled) VALUES (?, 1)'
);
for (const r of KNOWN_RETAILERS) {
  insertScraperDefault.run(r);
}

const stmtDeleteStockByProductId = db.prepare(
  `DELETE FROM stock_results WHERE product_id = ?`
);
const stmtDeleteProduct = db.prepare(`DELETE FROM products WHERE id = ?`);

const deleteProductCascade = db.transaction((productId) => {
  stmtDeleteStockByProductId.run(productId);
  return stmtDeleteProduct.run(productId);
});

// ─── Helpers ───────────────────────────────────────────────────────────────

const dbHelpers = {
  // Products
  addProduct: db.prepare(`
    INSERT INTO products (name, game, search_term) VALUES (?, ?, ?)
  `),
  getAllProducts: db.prepare(`SELECT * FROM products ORDER BY name`),
  getEnabledProducts: db.prepare(`SELECT * FROM products WHERE enabled = 1 ORDER BY name`),
  getProductsByGame: db.prepare(`SELECT * FROM products WHERE game = ?`),
  getProductById: db.prepare(`SELECT * FROM products WHERE id = ?`),
  setProductEnabled: db.prepare(`UPDATE products SET enabled = ? WHERE id = ?`),
  deleteProductById: (productId) => deleteProductCascade(productId),

  // Stock results
  insertStockResult: db.prepare(`
    INSERT INTO stock_results (product_id, retailer, in_stock, price, url, store_type, zip_code, scraped_product_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `),
  clearAllStockResults: db.prepare(`DELETE FROM stock_results`),

  // Get latest result per retailer per product (for the API)
  getLatestStockForProduct: db.prepare(`
    SELECT sr.*,
      COALESCE(NULLIF(TRIM(sr.scraped_product_name), ''), p.name) as product_name,
      p.game
    FROM stock_results sr
    JOIN products p ON p.id = sr.product_id
    WHERE sr.product_id = ?
    AND sr.checked_at = (
      SELECT MAX(checked_at) FROM stock_results
      WHERE product_id = sr.product_id AND retailer = sr.retailer AND store_type = sr.store_type
    )
    ORDER BY sr.retailer
  `),

  // Only in-stock items across all products
  getAllInStock: db.prepare(`
    SELECT sr.*,
      COALESCE(NULLIF(TRIM(sr.scraped_product_name), ''), p.name) as product_name,
      p.game
    FROM stock_results sr
    JOIN products p ON p.id = sr.product_id
    WHERE sr.in_stock = 1
    AND p.enabled = 1
    AND sr.checked_at >= datetime('now', '-3 hours')
    ORDER BY sr.checked_at DESC
  `),

  // Scrape log
  logScrape: db.prepare(`
    INSERT INTO scrape_log (retailer, status, message) VALUES (?, ?, ?)
  `),

  // Push tokens
  registerToken: db.prepare(`
    INSERT OR REPLACE INTO push_tokens (token, zip_code, games) VALUES (?, ?, ?)
  `),
  getAllTokens: db.prepare(`SELECT * FROM push_tokens`),

  getScraperSettings: db.prepare(`SELECT retailer, enabled FROM scraper_settings ORDER BY retailer`),
  setScraperEnabled: db.prepare(`UPDATE scraper_settings SET enabled = ? WHERE retailer = ?`),
};

// Seed some default products to track if DB is fresh
const existingProducts = db.prepare('SELECT COUNT(*) as count FROM products').get();
if (existingProducts.count === 0) {
  console.log('[DB] Seeding default products to track...');
  const defaultProducts = [
    ['Scarlet & Violet 151', 'pokemon', 'pokemon 151 booster box'],
    ['Twilight Masquerade', 'pokemon', 'pokemon twilight masquerade booster'],
    ['Surging Sparks', 'pokemon', 'pokemon surging sparks booster'],
    ['One Piece Paramount War', 'onepiece', 'one piece card game paramount war'],
    ['One Piece Wings of Captain', 'onepiece', 'one piece wings of the captain'],
    ['Yu-Gi-Oh Rage of the Abyss', 'yugioh', 'yugioh rage of the abyss booster'],
  ];
  for (const [name, game, search_term] of defaultProducts) {
    dbHelpers.addProduct.run(name, game, search_term);
  }
  console.log(`[DB] Seeded ${defaultProducts.length} products.`);
}

module.exports = { db, dbHelpers, KNOWN_RETAILERS };
