import 'dotenv/config';
import { markNotified } from '../db/client.js';

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_ID = process.env.TG_GROUP_ID;
const TOPIC_UPWORK = process.env.TG_TOPIC_UPWORK ? Number(process.env.TG_TOPIC_UPWORK) : null;
const TG_LIMIT = 4000;

function escapeHtml(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatJob(job) {
  const budget = job.type === 'HOURLY'
    ? `$${job.hourly_min || '?'}-${job.hourly_max || '?'}/hr`
    : `$${job.fixed_budget || '?'} fixed`;

  const skills = Array.isArray(job.skills)
    ? job.skills.map(s => s.name || s).filter(Boolean).join(', ')
    : '';

  const hireRate = job.client_hire_rate != null
    ? `${Math.round(job.client_hire_rate * 100)}% hire rate`
    : null;

  const clientParts = [
    job.client_country,
    job.client_score ? `⭐ ${job.client_score}` : 'no score',
    job.client_total_spend ? `spent $${Math.round(job.client_total_spend).toLocaleString()}` : 'no spend',
    job.client_total_jobs ? `${job.client_total_jobs} jobs` : null,
    hireRate,
    job.client_payment_verified ? 'verified' : 'not verified',
  ].filter(Boolean);

  const raw = job.llm_raw || {};
  const flags = [
    raw.is_new_client && 'new client',
    raw.quick_demo_possible && 'demo possible',
    raw.newcomer_friendly && 'newcomer friendly',
  ].filter(Boolean);

  const desc = (job.description || '').trim();

  // Описание под спойлером — обрезаем если > 3500 чтобы влезло в лимит
  const descText = desc.length > 3500 ? desc.substring(0, 3500) + '...' : desc;

  return [
    `<b>${escapeHtml(job.title)}</b>`,
    `${budget} | Score: ${job.overall_score || '?'}/10 | ${job.total_applicants ?? '?'} proposals | ${job.level || ''}`,
    `Client: ${escapeHtml(clientParts.join(' · '))}`,
    flags.length ? `Flags: ${flags.join(' · ')}` : null,
    skills ? `Skills: ${escapeHtml(skills)}` : null,
    job.llm_reasoning ? `AI: <i>${escapeHtml(job.llm_reasoning)}</i>` : null,
    `\n<tg-spoiler>${escapeHtml(descText)}</tg-spoiler>`,
    `\n<a href="${job.url}">Upwork</a>`,
  ].filter(Boolean).join('\n');
}

function jobButtons(jobId) {
  return {
    inline_keyboard: [[
      { text: 'Подходит', callback_data: `fb:good:${jobId}` },
      { text: 'Не моё', callback_data: `fb:bad:${jobId}` },
    ]]
  };
}

export async function sendMessage(text, options = {}) {
  if (!BOT_TOKEN) { console.warn('[telegram] BOT_TOKEN not set'); return null; }

  const chatId = GROUP_ID || process.env.TELEGRAM_CHAT_ID;
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...options,
  };
  if (TOPIC_UPWORK && !options.message_thread_id) {
    body.message_thread_id = TOPIC_UPWORK;
  }

  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram error: ${data.description}`);
  return data.result;
}

export async function notifyNewJobs(jobs) {
  if (!jobs.length) return;

  await sendMessage(`<b>Upwork: ${jobs.length} new relevant jobs</b>`);

  for (const job of jobs) {
    try {
      await sendMessage(formatJob(job), { reply_markup: jobButtons(job.id) });
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.error(`[telegram] Failed to send job ${job.id}:`, err.message);
    }
  }

  await markNotified(jobs.map(j => j.id));
  console.log(`[telegram] Sent ${jobs.length} job(s)`);
}
