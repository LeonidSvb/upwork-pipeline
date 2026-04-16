import 'dotenv/config';
import { saveFeedback } from '../db/client.js';

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GROUP_ID = process.env.TG_GROUP_ID;

const BAD_REASONS = [
  { text: 'Мало платят', code: 'low_budget' },
  { text: 'Не моя специализация', code: 'wrong_skill' },
  { text: 'Подозрительный клиент', code: 'bad_client' },
  { text: 'Много заявок', code: 'too_competitive' },
  { text: 'Требуют опыт/отзывы', code: 'need_reviews' },
];

let offset = 0;

async function api(method, body = {}) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function answerCallback(callbackId, text = '') {
  await api('answerCallbackQuery', { callback_query_id: callbackId, text });
}

async function editButtons(chatId, messageId, text, buttons = null) {
  const body = { chat_id: chatId, message_id: messageId, parse_mode: 'HTML' };
  if (buttons !== null) {
    body.reply_markup = buttons ? { inline_keyboard: buttons } : { inline_keyboard: [] };
  }
  await api('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: body.reply_markup || { inline_keyboard: [] } });
}

async function sendReply(chatId, threadId, text, replyMarkup = null) {
  const body = { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (threadId) body.message_thread_id = threadId;
  if (replyMarkup) body.reply_markup = replyMarkup;
  return api('sendMessage', body);
}

async function handleCallback(cb) {
  const data = cb.data;
  const chatId = cb.message.chat.id;
  const messageId = cb.message.message_id;
  const threadId = cb.message.message_thread_id;

  const [, action, jobId, reasonCode] = data.split(':');

  if (action === 'good') {
    await saveFeedback(jobId, 'good');
    await answerCallback(cb.id, 'Отмечено');
    await editButtons(chatId, messageId, null, null);
    console.log(`[feedback] good — ${jobId}`);
  }

  if (action === 'skip') {
    await saveFeedback(jobId, 'skip');
    await answerCallback(cb.id, 'Пропущено');
    await editButtons(chatId, messageId, null, null);
    console.log(`[feedback] skip — ${jobId}`);
  }

  if (action === 'bad') {
    await answerCallback(cb.id);
    const reasonButtons = BAD_REASONS.map(r => ([{
      text: r.text,
      callback_data: `fb:reason:${jobId}:${r.code}`
    }]));
    await sendReply(chatId, threadId, 'Почему не подходит?', { inline_keyboard: reasonButtons });
  }

  if (action === 'reason') {
    const reason = BAD_REASONS.find(r => r.code === reasonCode)?.text || reasonCode;
    await saveFeedback(jobId, 'bad', reason);
    await answerCallback(cb.id, 'Записано');
    await editButtons(chatId, messageId, null, null);
    console.log(`[feedback] bad (${reason}) — ${jobId}`);
  }
}

async function poll() {
  const data = await api('getUpdates', { offset, timeout: 30, allowed_updates: ['callback_query'] });
  if (!data.ok || !data.result?.length) return;

  for (const update of data.result) {
    offset = update.update_id + 1;
    if (update.callback_query?.data?.startsWith('fb:')) {
      try {
        await handleCallback(update.callback_query);
      } catch (err) {
        console.error('[bot] callback error:', err.message);
      }
    }
  }
}

async function main() {
  console.log('[bot] Starting polling...');
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
