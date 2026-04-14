import 'dotenv/config';
import cron from 'node-cron';
import { runScrapeAll } from './scrape.js';
import { enrichPending } from './enrich.js';
import { getTopJobs, markNotified } from '../db/client.js';
import { notifyNewJobs } from '../notifications/telegram.js';

// Фильтры для уведомлений
const NOTIFY_FILTERS = {
  minScore: 6,
  maxProposals: 15,   // <= 15 конкурентов или неизвестно
  hourlyMin: 15,      // от $15/hr
  hourlyMax: 45,      // до $45/hr
  fixedMax: 500,      // fixed до $500
};

async function fullPipeline() {
  const now = new Date().toISOString();
  console.log(`\n[pipeline] === Run at ${now} ===`);

  // 1. Scrape (age: 30 min, sort: newest)
  const scrapeResults = await runScrapeAll();
  const totalNew = scrapeResults.reduce((sum, r) => sum + (r.new || 0), 0);
  console.log(`[pipeline] New jobs this cycle: ${totalNew}`);

  if (totalNew === 0) {
    console.log('[pipeline] Nothing new, skipping');
    return;
  }

  // 2. LLM enrichment
  await enrichPending(Math.min(totalNew + 10, 100));

  // 3. Получаем подходящие вакансии (ещё не отправленные)
  const jobs = await getTopJobs(20, NOTIFY_FILTERS);
  console.log(`[pipeline] ${jobs.length} jobs match filters (score>=${NOTIFY_FILTERS.minScore}, proposals<=${NOTIFY_FILTERS.maxProposals}, budget OK)`);

  if (jobs.length > 0) {
    await notifyNewJobs(jobs);
  }

  console.log('[pipeline] === Done ===\n');
}

// Запуск сразу
fullPipeline().catch(console.error);

// Каждые 30 минут: в 0 и 30 минут каждого часа
cron.schedule('0,30 * * * *', () => {
  fullPipeline().catch(console.error);
});

console.log('[pipeline] Scheduled: every 30 min (at :00 and :30). Ctrl+C to stop.');
