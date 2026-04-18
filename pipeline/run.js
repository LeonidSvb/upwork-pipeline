import 'dotenv/config';
import { runScrapeAll } from './scrape.js';
import { enrichPending } from './enrich.js';
import { getTopJobs } from '../db/client.js';
import { notifyNewJobs } from '../notifications/telegram.js';
import { startServer } from '../server.js';
import { CONFIG } from '../config.js';

startServer();

export async function fullPipeline() {
  const now = new Date().toISOString();
  console.log(`\n[pipeline] === Run at ${now} ===`);

  const scrapeResults = await runScrapeAll();
  const totalNew = scrapeResults.reduce((sum, r) => sum + (r.new || 0), 0);
  console.log(`[pipeline] New jobs this cycle: ${totalNew}`);

  if (totalNew > 0) {
    await enrichPending(Math.min(totalNew + 10, 100));
  }

  const jobs = await getTopJobs(20, CONFIG.notify);
  console.log(`[pipeline] ${jobs.length} unnotified jobs match filters`);

  if (jobs.length > 0) {
    await notifyNewJobs(jobs);
  }

  console.log('[pipeline] === Done ===\n');
  return { totalNew, sent: jobs.length };
}

console.log('[pipeline] Ready. Use /run in Telegram to trigger.');
