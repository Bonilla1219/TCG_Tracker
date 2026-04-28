// scheduler/runNow.js
// Run this manually to trigger a scrape immediately:
//   node scheduler/runNow.js

const { runAllScrapers } = require('./scrapeRunner');

runAllScrapers()
  .then(() => {
    console.log('Manual scrape complete. Exiting.');
    process.exit(0);
  })
  .catch(err => {
    console.error('Scrape failed:', err);
    process.exit(1);
  });
