// server.js
// Main entry point. Starts the Express API and the cron scheduler.
//
// Usage:
//   node server.js          — production
//   nodemon server.js       — development (auto-restarts on file changes)

require('dotenv').config();

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const routes  = require('./api/routes');
const { startScheduler } = require('./scheduler/cronScheduler');

const app  = express();
const PORT = process.env.PORT || 3001;

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors()); // Allow your Expo app to call this API
app.use(express.json());

// Simple request logger
app.use((req, res, next) => {
  console.log(`[API] ${req.method} ${req.path}`);
  next();
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api', routes);

// Admin dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'api/dashboard.html'));
});

// Root info page
app.get('/', (req, res) => {
  res.json({
    name: 'TCG Tracker API',
    version: '1.0.0',
    endpoints: {
      health:          'GET  /api/health',
      products:        'GET  /api/products',
      productToggle:   'PATCH /api/products/:productId',
      addProduct:      'POST /api/products',
      allInStock:      'GET  /api/stock',
      stockByProduct:  'GET  /api/stock/:productId',
      stockSummary:    'GET  /api/stock/view/summary',
      registerToken:   'POST /api/register-token',
      manualScrape:    'POST /api/scrape/run',
      scrapers:        'GET  /api/scrapers',
      scrapersUpdate:  'PATCH /api/scrapers',
      logs:            'GET  /api/logs',
    },
  });
});

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('\n🃏 TCG Tracker Backend');
  console.log(`   API running at: http://localhost:${PORT}`);
  console.log(`   Health check:   http://localhost:${PORT}/api/health\n`);

  // Start the background scrape scheduler
  startScheduler();
});
