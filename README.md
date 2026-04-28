# 🃏 TCG Tracker — Backend Scraper + API

A backend service that scrapes Target, Walmart, Best Buy, and Amazon for TCG card
stock availability every 2 hours, stores results in a local database, and exposes
a REST API your Expo app can call.

---

## Project Structure

```
tcg-tracker/
├── server.js                 ← Entry point (API + scheduler)
├── .env.example              ← Copy to .env and fill in
│
├── scrapers/
│   ├── BaseScraper.js        ← Base class all scrapers extend
│   ├── TargetScraper.js      ← Target scraper
│   ├── WalmartScraper.js     ← Walmart scraper
│   ├── BestBuyScraper.js     ← Best Buy scraper
│   └── AmazonScraper.js      ← Amazon scraper (⚠️ may hit bot detection)
│
├── scheduler/
│   ├── scrapeRunner.js       ← Orchestrates all scrapers
│   ├── cronScheduler.js      ← Runs scrapeRunner every 2 hours
│   └── runNow.js             ← Manual trigger script
│
├── api/
│   └── routes.js             ← All REST API endpoints
│
├── db/
│   └── database.js           ← SQLite setup + helpers
│
└── data/
    └── tcg_tracker.db        ← Auto-created SQLite database
```

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Install Playwright browsers

```bash
npx playwright install chromium
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:
```
PORT=3001
DEFAULT_ZIP_CODE=85201        # Your zip code for in-store checks
SCRAPE_CRON="0 */2 * * *"    # Every 2 hours (change if you want)
```

### 4. Start the server

```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

The API will be live at `http://localhost:3001`

---

## Running a Manual Scrape

To test immediately without waiting for the cron:

```bash
npm run scrape
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server status + last scrape time |
| GET | `/api/products` | All tracked products |
| POST | `/api/products` | Add a product to track |
| GET | `/api/stock` | All in-stock items (last 3hrs) |
| GET | `/api/stock?game=pokemon` | Filter by game |
| GET | `/api/stock/:productId` | Stock for one product |
| GET | `/api/stock/view/summary` | Full summary grouped by game |
| POST | `/api/scrape/run` | Trigger manual scrape |
| POST | `/api/register-token` | Register Expo push token |
| GET | `/api/logs` | Recent scrape history |

---

## Adding New Products to Track

### Via API (recommended):

```bash
curl -X POST http://localhost:3001/api/products \
  -H "Content-Type: application/json" \
  -d '{"name":"Stellar Crown","game":"pokemon","search_term":"pokemon stellar crown booster box"}'
```

### Via code (in `db/database.js`):
Add to the `defaultProducts` array in the seed section.

---

## Connecting to Your Expo App

In your React Native app, call the API like this:

```javascript
// services/stockApi.js

const API_BASE = 'http://YOUR_SERVER_IP:3001/api';
// Use your local IP (not localhost) when testing on a real phone
// e.g., http://192.168.1.100:3001/api

export async function getInStockItems(game = null) {
  const url = game ? `${API_BASE}/stock?game=${game}` : `${API_BASE}/stock`;
  const res = await fetch(url);
  const data = await res.json();
  return data.data;
}

export async function registerPushToken(token, zipCode, games) {
  await fetch(`${API_BASE}/register-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, zip_code: zipCode, games }),
  });
}
```

---

## Important Notes on Scraping

### Amazon ⚠️
Amazon aggressively blocks bots. The scraper will detect if it hits a CAPTCHA
and skip gracefully. If Amazon is consistently blocked, consider:
- Using their **Product Advertising API** (requires approval, but reliable)
- Using a rotating proxy service like **Bright Data** or **Oxylabs**

### Target & Walmart
Both use heavy JavaScript rendering — Playwright handles this well, but scrapes
take 5-10 seconds per product. With 6 products × 4 retailers, expect each full
run to take **4-6 minutes**.

### Rate Limiting
The scraper adds random delays between requests to avoid getting blocked.
The 2-hour interval is intentionally conservative. Don't reduce it below 30 minutes
or you risk getting your IP banned.

---

## Deploying to a Server

For the app to work for real users, this needs to run on a server (not your laptop).

Cheap options:
- **Railway** (~$5/mo) — easiest, just push to GitHub and it deploys
- **Render** — has a free tier, but free tier sleeps after inactivity
- **DigitalOcean Droplet** (~$6/mo) — more control, use PM2 to keep it running

```bash
# Keep it running with PM2 (on a VPS)
npm install -g pm2
pm2 start server.js --name tcg-tracker
pm2 save
pm2 startup
```
