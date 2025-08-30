// api/telegram-webhook.js
// Vercel Edge Function: Telegram webhook → Google Sheets (Apps Script Web App)

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // --- Проверка секрета вебхука от Telegram (настраивается в setWebhook) ---
  const secretRequired = process.env.TG_WEBHOOK_SECRET;
  const incoming = req.headers.get('x-telegram-bot-api-secret-token');
  if (secretRequired && incoming !== secretRequired) {
    return json({ ok: false, error: 'forbidden' }, 403);
  }

  // Разрешаем только POST от Telegram
  if (req.method !== 'POST') {
    // Отвечаем 200, чтобы Telegram не ретраил
    return json({ ok: true, info: 'Telegram webhook is up' }, 200);
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) return json({ ok: false, error: 'BOT_TOKEN missing' }, 500);

  const update = await safeJson(req);
  const api = (method, payload) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  try {
    const msg = update?.message;

    // --- /start: присылаем кнопку открытия миниапа ---
    if (msg?.text === '/start') {
      const chat_id = msg.chat.id;
      const url = process.env.MINIAPP_URL || 'https://your-app.vercel.app';
      await api('sendMessage', {
        chat_id,
        text: 'Tap the button below to open the course 👇',
        reply_markup: {
          keyboard: [[{ text: 'Open course', web_app: { url } }]],
          resize_keyboard: true,
          one_time_keyboard: true,
        },
      });
      return json({ ok: true });
    }

    // --- Данные из WebApp (sendData) ---
    const wad = msg?.web_app_data?.data;
    if (wad) {
      const chat_id = msg.chat.id;
      const from = msg.from || {};
      let email = null, source = 'pickle-miniapp';

      try {
        const parsed = JSON.parse(wad);
        email = String(parsed.email || '').trim();
        source = parsed.source || source;
      } catch (_) {}

      if (!email) {
        await api('sendMessage', { chat_id, text: 'Could not read your email. Please try again.' });
        return json({ ok: true });
      }

      // --- Пишем строку в Google Sheets через Apps Script Web App ---
      const SHEETS_URL = process.env.SHEETS_URL;     // URL из Deploy Apps Script (Web app)
      const SHEETS_SECRET = process.env.SHEETS_SECRET; // такой же, как в Script Properties
      if (SHEETS_URL) {
        await fetch(SHEETS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            tg_user_id: from.id || '',
            tg_username: from.username || '',
            source,
            ts: new Date().toISOString(),
            secret: SHEETS_SECRET || undefined, // если секрет настроен — уйдёт в теле
          }),
        }).catch(() => null);
      }

      // Ответ пользователю в чат
      await api('sendMessage', {
        chat_id,
        text: 'Thanks! Your email is saved. You can continue in the Mini App 🎉',
      });

      return json({ ok: true });
    }

    // --- Неинтересные апдейты просто подтверждаем ---
    return json({ ok: true });
  } catch (e) {
    // Никогда не даём Telegram 5xx надолго — чтобы не было ретраев
    return json({ ok: true, warn: String(e) });
  }
}

/* ---------- helpers ---------- */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
async function safeJson(req) {
  try { return await req.json(); } catch { return {}; }
}
