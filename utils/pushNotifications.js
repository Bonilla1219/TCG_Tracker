// utils/pushNotifications.js
// Sends push alerts to registered Expo app users when items come in stock.
//
// Uses Expo's free push notification service — no paid plan needed.
// Your Expo app just needs to register its push token (POST /api/register-token).

const { dbHelpers } = require('../db/database');

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/**
 * Check the latest stock results and notify any users whose
 * tracked games just came back in stock.
 * Call this at the end of each scrape run.
 */
async function sendStockAlerts(newlyInStockResults) {
  if (!newlyInStockResults || newlyInStockResults.length === 0) return;

  const tokens = dbHelpers.getAllTokens.all();
  if (tokens.length === 0) {
    console.log('[Push] No registered push tokens — skipping notifications');
    return;
  }

  console.log(`[Push] Sending alerts for ${newlyInStockResults.length} in-stock items to ${tokens.length} users`);

  for (const result of newlyInStockResults) {
    const messages = [];

    for (const tokenRow of tokens) {
      const userGames = JSON.parse(tokenRow.games || '[]');
      if (userGames.length > 0 && !userGames.includes(result.game)) continue;

      const retailerLabel = capitalize(result.retailer);
      const storeLabel = result.store_type === 'in_store' ? 'in store near you' : 'online';

      messages.push({
        to: tokenRow.token,
        sound: 'default',
        title: `🃏 ${result.product_name} is in stock!`,
        body: `Available ${storeLabel} at ${retailerLabel}${result.price ? ` — ${result.price}` : ''}`,
        data: {
          productId: result.product_id,
          retailer: result.retailer,
          storeType: result.store_type,
          url: result.url,
        },
      });
    }

    if (messages.length === 0) continue;

    const chunks = chunkArray(messages, 100);
    for (const chunk of chunks) {
      try {
        const response = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk),
        });
        const data = await response.json();
        const errors = data.data?.filter(r => r.status === 'error') || [];
        if (errors.length > 0) {
          console.warn(`[Push] ${errors.length} delivery errors:`, errors.map(e => e.message));
        } else {
          console.log(`[Push] ✅ Sent ${chunk.length} notifications for "${result.product_name}"`);
        }
      } catch (err) {
        console.error('[Push] Failed to send notifications:', err.message);
      }
    }
  }
}

function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
function chunkArray(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

module.exports = { sendStockAlerts };
