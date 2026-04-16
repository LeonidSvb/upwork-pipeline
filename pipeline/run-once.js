import 'dotenv/config';
import { runScrapeAll } from './scrape.js';
import { enrichPending } from './enrich.js';
import { getTopJobs } from '../db/client.js';
import { notifyNewJobs } from '../notifications/telegram.js';
import { notifyError, sendDailyDigest } from '../notifications/system.js';
import { processPendingCallbacks } from '../telegram/callbacks.js';
import { CONFIG } from '../config.js';

const hour = new Date().getUTCHours();
const DIGEST_HOUR = 9; // UTC — отправлять дайджест раз в сутки в 9:00 UTC

async function main() {
  const now = new Date().toISOString();
  console.log(`[pipeline] === Run at ${now} ===`);

  // 0. Feedback callbacks
  try {
    await processPendingCallbacks();
  } catch (err) {
    await notifyError('processPendingCallbacks', err);
  }

  // 1. Scrape
  let totalNew = 0;
  try {
    const scrapeResults = await runScrapeAll();
    totalNew = scrapeResults.reduce((sum, r) => sum + (r.new || 0), 0);
    console.log(`[pipeline] New jobs this cycle: ${totalNew}`);
  } catch (err) {
    await notifyError('scrape', err);
  }

  // 2. Enrich
  try {
    if (totalNew > 0) {
      await enrichPending(Math.min(totalNew + 10, 100));
    }
  } catch (err) {
    await notifyError('enrich', err);
  }

  // 3. Notify
  try {
    const jobs = await getTopJobs(20, CONFIG.notify);
    console.log(`[pipeline] ${jobs.length} unnotified jobs match filters`);
    if (jobs.length > 0) {
      await notifyNewJobs(jobs);
    }
  } catch (err) {
    await notifyError('notify', err);
  }

  // 4. Daily digest (раз в сутки)
  if (hour === DIGEST_HOUR) {
    try {
      await sendDailyDigest();
    } catch (err) {
      console.error('[pipeline] digest error:', err.message);
    }
  }

  console.log('[pipeline] === Done ===');
  process.exit(0);
}

main().catch(async err => {
  await notifyError('fatal', err);
  process.exit(1);
});
