// scheduler/cronScheduler.js
// Sets up the recurring scrape job using node-cron.
// Imported by server.js so it runs whenever the server is up.

const cron = require('node-cron');
const { runAllScrapers } = require('./scrapeRunner');

require('dotenv').config();

// Default: every 2 hours at the top of the hour
// Override with SCRAPE_CRON env var (standard cron syntax)
const CRON_SCHEDULE = process.env.SCRAPE_CRON || '0 */2 * * *';

function startScheduler() {
  console.log(`⏰ Scrape scheduler started — running on: "${CRON_SCHEDULE}"`);
  console.log(`   Next run: ${getNextRunTime(CRON_SCHEDULE)}\n`);

  cron.schedule(CRON_SCHEDULE, async () => {
    console.log('[Scheduler] Cron triggered — starting scrape run...');
    try {
      await runAllScrapers();
    } catch (err) {
      console.error('[Scheduler] Scrape run failed:', err);
    }
  });
}

function getNextRunTime(cronExpression) {
  // Simple human-readable next-run estimate
  try {
    const task = cron.schedule(cronExpression, () => {}, { scheduled: false });
    return 'See cron expression: ' + cronExpression;
  } catch (e) {
    return 'Unknown';
  }
}

module.exports = { startScheduler };
