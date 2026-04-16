import 'dotenv/config';
import { getDailyStats } from '../db/client.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_ID = process.env.TG_GROUP_ID;
const TOPIC_SYSTEM = process.env.TG_TOPIC_SYSTEM ? Number(process.env.TG_TOPIC_SYSTEM) : null;

async function sendSystem(text) {
  if (!BOT_TOKEN || !GROUP_ID) return;
  const body = {
    chat_id: GROUP_ID,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  if (TOPIC_SYSTEM) body.message_thread_id = TOPIC_SYSTEM;

  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function notifyError(context, err) {
  const text = [
    `<b>Pipeline error — ${context}</b>`,
    `<code>${(err.message || String(err)).substring(0, 500)}</code>`,
    new Date().toISOString(),
  ].join('\n');

  console.error(`[system] ${context}:`, err.message || err);
  try { await sendSystem(text); } catch {}
}

export async function sendDailyDigest() {
  const s = await getDailyStats();
  const lastRun = s.last_run ? new Date(s.last_run).toLocaleString('ru-RU') : 'N/A';

  const text = [
    `<b>Daily digest — ${new Date().toLocaleDateString('ru-RU')}</b>`,
    `Last run: ${lastRun}`,
    `Failed runs 24h: ${s.failed_runs_24h}`,
    ``,
    `Jobs total: ${s.total_jobs}`,
    `New jobs 24h: ${s.jobs_24h}`,
    `Enriched 24h: ${s.enriched_24h}`,
    `Notified 24h: ${s.notified_24h}`,
    ``,
    `Feedback 24h: ${s.feedback_24h} (good: ${s.good_24h}, bad: ${s.bad_24h})`,
  ].join('\n');

  await sendSystem(text);
}
