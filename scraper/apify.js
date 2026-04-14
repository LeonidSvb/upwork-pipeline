import 'dotenv/config';

const ACTOR_ID = process.env.APIFY_ACTOR_ID || 'jupri~upwork';
const BASE_URL = 'https://api.apify.com/v2';

// Все доступные ключи - ротируем при ошибках
const API_KEYS = [
  process.env.APIFY_API_KEY,
  process.env.APIFY_API_KEY_2,
  process.env.APIFY_API_KEY_3,
  process.env.APIFY_API_KEY_4,
].filter(Boolean);

let currentKeyIndex = 0;

function getKey() {
  return API_KEYS[currentKeyIndex];
}

function rotateKey() {
  currentKeyIndex = (currentKeyIndex + 1) % API_KEYS.length;
  console.log(`[apify] Rotating to key #${currentKeyIndex + 1}`);
  return API_KEYS[currentKeyIndex];
}

export async function runScraper(input) {
  let lastError;

  for (let attempt = 0; attempt < API_KEYS.length; attempt++) {
    const key = getKey();
    const res = await fetch(`${BASE_URL}/acts/${ACTOR_ID}/runs?token=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = await res.json();

    if (data.error) {
      const msg = data.error.message || '';
      // Пробуем следующий ключ если проблема с авторизацией или триалом
      if (msg.includes('trial') || msg.includes('subscription') || msg.includes('auth') || res.status === 401 || res.status === 403) {
        console.warn(`[apify] Key #${currentKeyIndex + 1} issue: ${msg}`);
        rotateKey();
        lastError = msg;
        continue;
      }
      throw new Error(`Apify error: ${msg}`);
    }

    return data.data;
  }

  throw new Error(`All Apify keys exhausted. Last error: ${lastError}`);
}

export async function waitForRun(runId, pollIntervalMs = 3000) {
  const key = getKey();
  while (true) {
    const res = await fetch(`${BASE_URL}/actor-runs/${runId}?token=${key}`);
    const { data } = await res.json();
    if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(data.status)) {
      return data;
    }
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }
}

export async function getDataset(datasetId) {
  const key = getKey();
  const res = await fetch(`${BASE_URL}/datasets/${datasetId}/items?token=${key}&limit=500`);
  return res.json();
}

export async function scrapeAndWait(input) {
  console.log(`[scraper] Starting: "${input['search.any']?.substring(0, 40) || input.search || 'query'}"`);
  const run = await runScraper(input);
  console.log(`[scraper] Run ${run.id} started (key #${currentKeyIndex + 1})`);

  const completed = await waitForRun(run.id);
  if (completed.status !== 'SUCCEEDED') {
    throw new Error(`Run ${run.id} failed: ${completed.status}`);
  }

  const items = await getDataset(completed.defaultDatasetId);
  console.log(`[scraper] Got ${items.length} items in ${completed.stats.durationMillis}ms`);
  return items;
}
