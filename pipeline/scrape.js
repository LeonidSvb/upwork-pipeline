import 'dotenv/config';
import { scrapeAndWait } from '../scraper/apify.js';
import { upsertJobs, logScrapeRun } from '../db/client.js';
import { CONFIG } from '../config.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const searches = JSON.parse(readFileSync(resolve(__dirname, '../scraper/inputs/my-searches.json'), 'utf8'));

export async function runScrapeAll(age = null) {
  const results = [];

  for (const { name, input } of searches) {
    if (age) input.age = age;
    console.log(`\n[pipeline] Scraping: ${name}`);
    const startedAt = new Date();
    let runResult;

    try {
      const items = await scrapeAndWait(input);
      const { newCount, skippedCount } = await upsertJobs(items, {
        excludeCountries: CONFIG.excludeCountries,
        fixedMin: CONFIG.preFilter.fixedMin,
        hourlyMin: CONFIG.preFilter.hourlyMin,
        proposalsMax: CONFIG.preFilter.proposalsMax,
      });

      runResult = {
        search_query: name,
        input,
        items_fetched: items.length,
        items_new: newCount,
        status: 'succeeded',
        started_at: startedAt,
        finished_at: new Date(),
      };
      results.push({ name, count: items.length, new: newCount });
      console.log(`[pipeline] ${name}: ${items.length} fetched, ${newCount} new, ${skippedCount} skipped`);
    } catch (err) {
      runResult = {
        search_query: name,
        input,
        items_fetched: 0,
        items_new: 0,
        status: 'failed',
        error: err.message,
        started_at: startedAt,
        finished_at: new Date(),
      };
      console.error(`[pipeline] ${name} failed:`, err.message);
    }

    await logScrapeRun(runResult);
  }

  return results;
}

// Direct run: node pipeline/scrape.js
if (process.argv[1].endsWith('scrape.js')) {
  runScrapeAll().then(r => {
    console.log('\n[done]', r);
    process.exit(0);
  });
}
