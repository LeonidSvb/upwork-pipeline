import 'dotenv/config';
import { saveFeedback } from '../db/client.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

const BAD_REASONS = {
  low_budget: 'Мало платят',
  wrong_skill: 'Не моя специализация',
  bad_client: 'Подозрительный клиент',
  too_competitive: 'Много заявок',
  need_reviews: 'Требуют опыт/отзывы',
};

async function api(method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function getUpdates(offset) {
  const data = await api('getUpdates', {
    offset,
    limit: 100,
    allowed_updates: ['callback_query'],
  });
  return data.ok ? data.result : [];
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

async function sendReply(chatId, threadId, text, replyMarkup) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (threadId) body.message_thread_id = threadId;
  if (replyMarkup) body.reply_markup = replyMarkup;
  await api('sendMessage', body);
}

async function handleCallback(cb) {
  const data = cb.data;
  if (!data?.startsWith('fb:')) return;

  const parts = data.split(':');
  const action = parts[1];
  const jobId = parts[2];
  const reasonCode = parts[3];

  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const threadId = cb.message.message_thread_id;

  if (action === 'good') {
    await saveFeedback(jobId, 'good');
    await answerCallback(cb.id, 'Подходит — записано');
    await removeButtons(chatId, messageId);
    console.log(`[callbacks] good — ${jobId}`);
  }

  if (action === 'skip') {
    await saveFeedback(jobId, 'skip');
    await answerCallback(cb.id, 'Пропущено');
    await removeButtons(chatId, messageId);
    console.log(`[callbacks] skip — ${jobId}`);
  }

  if (action === 'bad') {
    await answerCallback(cb.id);
    const buttons = Object.entries(BAD_REASONS).map(([code, text]) => ([{
      text,
      callback_data: `fb:reason:${jobId}:${code}`,
    }]));
    await sendReply(chatId, threadId, 'Почему не подходит?', { inline_keyboard: buttons });
  }

  if (action === 'reason') {
    const reason = BAD_REASONS[reasonCode] || reasonCode;
    await saveFeedback(jobId, 'bad', reason);
    await answerCallback(cb.id, 'Записано');
    await removeButtons(chatId, messageId);
    console.log(`[callbacks] bad (${reason}) — ${jobId}`);
  }
}

export async function processPendingCallbacks() {
  const updates = await getUpdates(-100);
  if (!updates.length) return;

  console.log(`[callbacks] Processing ${updates.length} pending callbacks`);
  for (const u of updates) {
    if (u.callback_query) {
      try {
        await handleCallback(u.callback_query);
      } catch (err) {
        console.error('[callbacks] error:', err.message);
      }
    }
  }
}
