import 'dotenv/config';

const API_KEY = process.env.APIFY_API_KEY;
const ACTOR_ID = process.env.APIFY_ACTOR_ID || 'jupri~upwork';
const BASE_URL = 'https://api.apify.com/v2';

export async function runScraper(input) {
  const res = await fetch(`${BASE_URL}/acts/${ACTOR_ID}/runs?token=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await res.json();
  if (data.error) throw new Error(`Apify error: ${data.error.message}`);
  return data.data;
}

export async function waitForRun(runId, pollIntervalMs = 3000) {
  while (true) {
    const res = await fetch(`${BASE_URL}/actor-runs/${runId}?token=${API_KEY}`);
    const { data } = await res.json();
    if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(data.status)) {
      return data;
    }
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }
}

export async function getDataset(datasetId) {
  const res = await fetch(
    `${BASE_URL}/datasets/${datasetId}/items?token=${API_KEY}`
  );
  return res.json();
}

export async function scrapeAndWait(input) {
  console.log(`[scraper] Starting run: ${input.search || input.query}`);
  const run = await runScraper(input);
  console.log(`[scraper] Run ${run.id} started (${run.status})`);

  const completed = await waitForRun(run.id);
  if (completed.status !== 'SUCCEEDED') {
    throw new Error(`Run ${run.id} failed with status: ${completed.status}`);
  }

  const items = await getDataset(completed.defaultDatasetId);
  console.log(`[scraper] Got ${items.length} items (${completed.stats.durationMillis}ms)`);
  return items;
}
