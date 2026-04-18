import 'dotenv/config';
import { execFile } from 'child_process';
import { saveFeedback, saveSkoolFeedback, getPendingSkoolSignals } from '../db/client.js';
import { handleIdea } from './ideas.js';
import { runScrapeAll } from '../pipeline/scrape.js';
import { enrichPending } from '../pipeline/enrich.js';
import { getTopJobs, markNotified } from '../db/client.js';
import { notifyNewJobs } from '../notifications/telegram.js';
import { CONFIG } from '../config.js';
import cron from 'node-cron';

const SKOOL_DIR = new URL('../../skool-scrape-signals/', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');

const IDEAS_TOPIC_ID = parseInt(process.env.TG_TOPIC_IDEAS);

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

// userId → { jobId, jobMessageId, questionMessageId, chatId, threadId }
const waitingForReason = new Map();

let offset = 0;

async function api(method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function answerCallback(id, text = '') {
  await api('answerCallbackQuery', { callback_query_id: id, text });
}

async function removeButtons(chatId, messageId) {
  await api('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}

async function deleteMessage(chatId, messageId) {
  await api('deleteMessage', { chat_id: chatId, message_id: messageId });
}

async function sendMessage(chatId, threadId, text) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (threadId) body.message_thread_id = threadId;
  const res = await api('sendMessage', body);
  return res.result?.message_id;
}

async function sendSkoolSignalMessage(chatId, threadId, s, pos, total) {
  const contact = (() => { try { return typeof s.contact === 'string' ? JSON.parse(s.contact) : (s.contact || {}); } catch { return {}; } })();
  const conf = s.confidence === 'high' ? 'HIGH' : 'MED';
  const intent = (s.intent || '').replace('_', ' ');
  const stype = (s.signal_type || 'signal').replace(/_/g, ' ');
  const name = contact.name || 'Unknown';
  const linkedin = contact.linkedin || '';
  const namePart = linkedin ? `<a href="${linkedin}">${name}</a>` : name;
  const postUrl = s.post_url || `https://www.skool.com/${s.community || 'community'}?p=${s.post_id}`;
  const postLink = ` | <a href="${postUrl}">Open post</a>`;

  const text = [
    `[${pos}/${total}] [${conf}] ${stype} | ${intent} | ${s.community || 'skool'}`,
    `<b>${s.post_title || 'No title'}</b>`,
    `${namePart} (${contact.source || 'post'})${postLink}`,
    ``,
    `<i>"${(s.signal_text || '').slice(0, 200)}"</i>`,
    ``,
    `Why: ${s.reason || ''}`,
  ].join('\n');

  const keyboard = JSON.stringify({ inline_keyboard: [[
    { text: 'Good lead', callback_data: `sk:good:${s.post_id}` },
    { text: 'Skip', callback_data: `sk:skip:${s.post_id}` },
    { text: 'Not relevant', callback_data: `sk:bad:${s.post_id}` },
  ]]});

  const body = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: keyboard };
  if (threadId) body.message_thread_id = threadId;
  await api('sendMessage', body);
}

async function handleSkoolCallback(cb) {
  const parts = cb.data.split(':');
  const action = parts[1];
  const postId = parts.slice(2).join(':');
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const threadId = cb.message.message_thread_id;
  const userId = cb.from.id;

  if (action === 'good') {
    await saveSkoolFeedback(postId, 'good');
    await answerCallback(cb.id, 'Good lead saved');
    try { await removeButtons(chatId, messageId); } catch {}
    console.log(`[bot] skool good — ${postId}`);
    await sendNextPending(chatId, threadId, postId);
  }

  if (action === 'skip') {
    await answerCallback(cb.id, 'Skipped');
    try { await removeButtons(chatId, messageId); } catch {}
    await sendNextPending(chatId, threadId, postId);
  }

  if (action === 'bad') {
    await answerCallback(cb.id);
    const qId = await sendMessage(chatId, threadId, 'Почему не релевантно? Одним сообщением:');
    waitingForReason.set(userId, { type: 'skool', postId, jobMessageId: messageId, questionMessageId: qId, chatId, threadId });
    console.log(`[bot] skool waiting for reason — ${postId}`);
  }
}

async function sendNextPending(chatId, threadId, justDonePostId) {
  try {
    const all = await getPendingSkoolSignals();
    const remaining = all.filter(s => s.post_id !== justDonePostId);
    if (!remaining.length) {
      await reply(chatId, threadId, 'Очередь разобрана. Новых сигналов нет.');
      return;
    }
    const next = remaining[0];
    const pos = 1;
    const total = remaining.length;
    await sendSkoolSignalMessage(chatId, threadId, next, pos, total);
  } catch (e) {
    console.error('[bot] sendNextPending error:', e.message);
  }
}

async function handleCallback(cb) {
  const data = cb.data;
  if (data?.startsWith('sk:')) { await handleSkoolCallback(cb); return; }
  if (!data?.startsWith('fb:')) return;

  const [, action, jobId] = data.split(':');
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const threadId = cb.message.message_thread_id;
  const userId = cb.from.id;

  if (action === 'applied') {
    await saveFeedback(jobId, 'applied');
    await answerCallback(cb.id, 'Отклик записан');
    await removeButtons(chatId, messageId);
    console.log(`[bot] applied — ${jobId}`);
  }

  if (action === 'maybe') {
    await saveFeedback(jobId, 'maybe');
    await answerCallback(cb.id, 'Помечено как интересное');
    await api('editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [[
        { text: 'Откликнулся', callback_data: `fb:applied:${jobId}` },
        { text: 'Скрыть', callback_data: `fb:skip:${jobId}` },
      ]] },
    });
    console.log(`[bot] maybe — ${jobId}`);
  }

  if (action === 'good') {
    await saveFeedback(jobId, 'good');
    await answerCallback(cb.id, 'Отмечено');
    await removeButtons(chatId, messageId);
    console.log(`[bot] good — ${jobId}`);
  }

  if (action === 'skip') {
    await saveFeedback(jobId, 'skip');
    await answerCallback(cb.id, 'Пропущено');
    await deleteMessage(chatId, messageId);
    console.log(`[bot] skip — ${jobId}`);
  }

  if (action === 'bad') {
    await answerCallback(cb.id);
    const qId = await sendMessage(chatId, threadId, 'Почему не подходит? Напиши одним сообщением:');
    waitingForReason.set(userId, { jobId, jobMessageId: messageId, questionMessageId: qId, chatId, threadId });
    console.log(`[bot] waiting for reason — ${jobId}`);
  }
}

let pipelineRunning = false;
let cronJob = null;
let runCount = 0;
let lastRunAt = null;
let monitorChatId = null;
let monitorThreadId = null;

function nextRunTime() {
  const now = new Date();
  const next = new Date(now);
  const mins = now.getMinutes();
  const nextMins = Math.ceil((mins + 1) / 20) * 20;
  next.setMinutes(nextMins, 0, 0);
  if (next <= now) next.setMinutes(next.getMinutes() + 20);
  return next.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

async function reply(chatId, threadId, text) {
  const body = { chat_id: chatId, text };
  if (threadId) body.message_thread_id = threadId;
  await api('sendMessage', body);
}

async function runPipeline(chatId, threadId, age = 120, silent = false) {
  if (pipelineRunning) {
    if (!silent) await reply(chatId, threadId, 'Уже запущено, подожди...');
    return;
  }
  pipelineRunning = true;
  runCount++;
  lastRunAt = new Date();
  const label = age === 30 ? '30 мин' : '2 часа';
  if (!silent) await reply(chatId, threadId, `Скрейпинг за последние ${label}...`);
  try {
    const scrapeResults = await runScrapeAll(age);
    const totalNew = scrapeResults.reduce((sum, r) => sum + (r.new || 0), 0);
    if (totalNew > 0) await enrichPending(Math.min(totalNew + 10, 100));
    const jobs = await getTopJobs(20, CONFIG.notify);
    if (jobs.length > 0) {
      await notifyNewJobs(jobs);
      const next = cronJob ? ` Следующий в ${nextRunTime()}` : '';
      await reply(chatId, threadId, `Готово. Новых: ${totalNew}, отправлено: ${jobs.length}.${next}`);
    } else {
      const next = cronJob ? ` Следующий запуск в ${nextRunTime()}.` : '';
      await reply(chatId, threadId, `Запуск #${runCount} — подходящих нет.${next}`);
    }
  } catch (err) {
    await reply(chatId, threadId, `Ошибка: ${err.message}`);
    console.error('[bot] pipeline error:', err.message);
  }
  pipelineRunning = false;
}

async function handleMessage(msg) {
  const userId = msg.from?.id;

  if (msg.message_thread_id === IDEAS_TOPIC_ID) {
    await handleIdea(api, msg);
    return;
  }

  const text = msg.text?.trim() || '';
  const chatId = msg.chat.id;
  const threadId = msg.message_thread_id;

  if (text.startsWith('/help')) {
    await reply(chatId, threadId,
      'UPWORK\n' +
      '/upwork_run — разовый скрейп за 2 часа\n' +
      '/upwork_start — мониторинг каждые 20 мин\n' +
      '/upwork_stop — остановить мониторинг\n' +
      '/upwork_status — статус pipeline\n' +
      '\n' +
      'SKOOL\n' +
      '/skool_run — скрейп + classify\n' +
      '/skool_pending — очередь сигналов без фидбека\n' +
      '/skool_status — статистика сигналов'
    );
    return;
  }

  if (text.startsWith('/upwork_status')) {
    const monitoring = cronJob ? 'ON' : 'OFF';
    const last = lastRunAt ? lastRunAt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'не было';
    const next = cronJob ? ` Следующий в ${nextRunTime()}.` : '';
    await reply(chatId, threadId,
      `Мониторинг: ${monitoring}\nПоследний запуск: ${last}\nЗапусков за сессию: ${runCount}${next}`
    );
    return;
  }

  if (text.startsWith('/upwork_run')) {
    await runPipeline(chatId, threadId, 120);
    return;
  }

  if (text.startsWith('/upwork_start')) {
    if (cronJob) {
      await reply(chatId, threadId, `Мониторинг уже запущен. Следующий запуск в ${nextRunTime()}.`);
      return;
    }
    monitorChatId = chatId;
    monitorThreadId = threadId;
    cronJob = cron.schedule('*/20 * * * *', () => {
      runPipeline(monitorChatId, monitorThreadId, 30).catch(console.error);
    });
    await reply(chatId, threadId, `Мониторинг включен — каждые 20 мин. Следующий авто-запуск в ${nextRunTime()}. Запускаю первый скрейп...`);
    await runPipeline(chatId, threadId, 30);
    return;
  }

  if (text.startsWith('/upwork_stop')) {
    if (!cronJob) {
      await reply(chatId, threadId, 'Мониторинг не был запущен.');
      return;
    }
    cronJob.stop();
    cronJob = null;
    await reply(chatId, threadId, `Мониторинг остановлен. Было запусков: ${runCount}.`);
    runCount = 0;
    return;
  }

  if (text.startsWith('/skool_run')) {
    await reply(chatId, threadId, 'Запускаю Skool pipeline...');
    execFile('python', ['run.py'], { cwd: SKOOL_DIR }, async (err, stdout, stderr) => {
      const out = (stdout + stderr).slice(-1000);
      await reply(chatId, threadId, err ? `Skool ошибка:\n${out}` : `Skool готово:\n${out}`);
    });
    return;
  }

  if (text.startsWith('/skool_status')) {
    try {
      const all = await getPendingSkoolSignals();
      const high = all.filter(s => s.confidence === 'high').length;
      const med  = all.filter(s => s.confidence === 'medium').length;
      await reply(chatId, threadId,
        `Skool — ожидают фидбека: ${all.length}\n  HIGH: ${high}\n  MED: ${med}\n\n` +
        `Запусти /skool_pending чтобы пройтись`
      );
    } catch (e) {
      await reply(chatId, threadId, `Ошибка: ${e.message}`);
    }
    return;
  }

  if (text.startsWith('/skool_pending')) {
    try {
      const all = await getPendingSkoolSignals();
      if (!all.length) {
        await reply(chatId, threadId, 'Нет сигналов без фидбека.');
        return;
      }
      const highCount = all.filter(s => s.confidence === 'high').length;
      const useHighOnly = all.length > 10 && highCount > 0;
      const queue = useHighOnly ? all.filter(s => s.confidence === 'high') : all;

      if (useHighOnly) {
        await reply(chatId, threadId, `Всего ${all.length} pending. Показываю только HIGH (${highCount}). Для всех — /skool_pending all`);
      }

      const s = queue[0];
      await sendSkoolSignalMessage(chatId, threadId, s, 1, queue.length);
    } catch (e) {
      await reply(chatId, threadId, `Ошибка: ${e.message}`);
    }
    return;
  }

  if (!userId || !waitingForReason.has(userId)) return;

  const waiting = waitingForReason.get(userId);
  const reason = msg.text?.trim();
  if (!reason) return;

  waitingForReason.delete(userId);

  if (waiting.type === 'skool') {
    const { postId, jobMessageId, questionMessageId, chatId, threadId } = waiting;
    await saveSkoolFeedback(postId, 'bad', reason);
    await removeButtons(chatId, jobMessageId);
    try { await deleteMessage(chatId, questionMessageId); } catch {}
    try { await deleteMessage(chatId, msg.message_id); } catch {}
    console.log(`[bot] skool bad (${reason.substring(0, 60)}) — ${postId}`);
    await sendNextPending(chatId, threadId, postId);
  } else {
    const { jobId, jobMessageId, questionMessageId, chatId } = waiting;
    await saveFeedback(jobId, 'bad', reason);
    try { await deleteMessage(chatId, jobMessageId); } catch {}
    try { await deleteMessage(chatId, questionMessageId); } catch {}
    try { await deleteMessage(chatId, msg.message_id); } catch {}
    console.log(`[bot] bad (${reason.substring(0, 60)}) — ${jobId}`);
  }
}

async function poll() {
  const data = await api('getUpdates', {
    offset,
    timeout: 30,
    allowed_updates: ['callback_query', 'message'],
  });
  if (!data.ok || !data.result?.length) return;

  for (const update of data.result) {
    offset = update.update_id + 1;
    try {
      if (update.callback_query?.data?.startsWith('fb:')) {
        await handleCallback(update.callback_query);
      } else if (update.message?.text) {
        await handleMessage(update.message);
      }
    } catch (err) {
      console.error('[bot] error:', err.message);
    }
  }
}

async function main() {
  console.log('[bot] Starting...');
  while (true) {
    try {
      await poll();
    } catch (err) {
      console.error('[bot] poll error:', err.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

main();
