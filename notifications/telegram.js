import 'dotenv/config';
import { markNotified } from '../db/client.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatJob(job) {
  const budget = job.type === 'HOURLY'
    ? `$${job.hourly_min || '?'}-${job.hourly_max || '?'}/hr`
    : `$${job.fixed_budget || '?'} fixed`;

  const clientInfo = [
    job.client_country,
    job.client_score ? `score: ${job.client_score}` : null,
    job.client_total_spend ? `spent: $${Math.round(job.client_total_spend).toLocaleString()}` : null,
  ].filter(Boolean).join(' | ');

  const tags = Array.isArray(job.tags) ? job.tags.join(', ') : '';

  return [
    `<b>${escapeHtml(job.title)}</b>`,
    `${escapeHtml(budget)} | Score: ${job.overall_score || '?'}/10`,
    `Client: ${escapeHtml(clientInfo || 'N/A')}`,
    tags ? `Tags: ${escapeHtml(tags)}` : '',
    job.llm_reasoning ? `<i>${escapeHtml(job.llm_reasoning)}</i>` : '',
    `<a href="${job.url}">View Job</a>`,
  ].filter(Boolean).join('\n');
}

export async function sendTelegramMessage(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[telegram] Bot not configured');
    return;
  }

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });

  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram error: ${data.description}`);
  return data;
}

export async function notifyNewJobs(jobs) {
  if (!jobs.length) return;

  const header = `<b>Upwork: ${jobs.length} relevant jobs</b>\n${new Date().toLocaleString('ru-RU')}\n\n`;
  const chunks = [];
  let current = header;

  for (const job of jobs) {
    const formatted = formatJob(job) + '\n\n---\n\n';
    if ((current + formatted).length > 4000) {
      chunks.push(current);
      current = formatted;
    } else {
      current += formatted;
    }
  }
  if (current) chunks.push(current);

  for (const chunk of chunks) {
    await sendTelegramMessage(chunk);
  }

  await markNotified(jobs.map(j => j.id));
  console.log(`[telegram] Sent ${chunks.length} message(s) for ${jobs.length} jobs`);
}
