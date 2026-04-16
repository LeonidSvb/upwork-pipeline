import 'dotenv/config';
import { saveFeedback } from '../db/client.js';
import { handleIdea } from './ideas.js';

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

async function handleCallback(cb) {
  const data = cb.data;
  if (!data?.startsWith('fb:')) return;

  const [, action, jobId] = data.split(':');
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const threadId = cb.message.message_thread_id;
  const userId = cb.from.id;

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

async function handleMessage(msg) {
  const userId = msg.from?.id;

  if (msg.message_thread_id === IDEAS_TOPIC_ID) {
    await handleIdea(api, msg);
    return;
  }

  if (!userId || !waitingForReason.has(userId)) return;

  const { jobId, jobMessageId, questionMessageId, chatId } = waitingForReason.get(userId);
  const reason = msg.text?.trim();
  if (!reason) return;

  waitingForReason.delete(userId);

  await saveFeedback(jobId, 'bad', reason);
  await deleteMessage(chatId, jobMessageId);
  await deleteMessage(chatId, questionMessageId);
  await deleteMessage(chatId, msg.message_id);

  console.log(`[bot] bad (${reason.substring(0, 60)}) — ${jobId}`);
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
      } else if (update.message?.text && !update.message?.text?.startsWith('/')) {
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
