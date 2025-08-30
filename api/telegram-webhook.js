// api/telegram-webhook.js
// Telegram webhook → Google Sheets (Apps Script Web App). Без отладочных сообщений.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // Проверка секретного заголовка Telegram (secret_token)
  const expected = process.env.TG_WEBHOOK_SECRET;
  const got = req.headers.get('x-telegram-bot-api-secret-token');
  if (expected && got !== expected) {
    return json({ ok: false, error: 'forbidden' }, 403);
  }

  // На не-POST отвечаем 200 (Telegram иногда пингует)
  if (req.method !== 'POST') {
    return json({ ok: true }, 200);
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) return json({ ok: false, error: 'BOT_TOKEN missing' }, 500);

  const update = await safeJson(req);
  const msg = update?.message;
  const chat_id = msg?.chat?.id;

  const api = (method, payload) =>
    fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  try {
    // /start → кнопка открытия миниапа
    if (msg?.text === '/start' && chat_id) {
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

    // Данные из WebApp (Telegram.WebApp.sendData)
    const wad = msg?.web_app_data?.data;
    if (wad && chat_id) {
      const from = msg.from || {};
      let email = null;
      let source = 'pickle-miniapp';

      try {
        const parsed = JSON.parse(wad);
        email = String(parsed.email || '').trim();
        source = parsed.source || source;
      } catch {}

      if (!email) {
        await api('sendMessage', { chat_id, text: 'Could not read your email. Please try again.' });
        return json({ ok: true });
      }

      // Отправка в Google Sheets через Apps Script Web App (/exec)
      const SHEETS_URL = process.env.SHEETS_URL;       // формат: https://script.google.com/macros/s/<ID>/exec
      const SHEETS_SECRET = process.env.SHEETS_SECRET; // если включена проверка секрета в Apps Script

      if (SHEETS_URL) {
        const payload = {
          email,
          tg_user_id: from.id || '',
          tg_username: from.username || '',
          source,
          ts: new Date().toISOString(),
          secret: SHEETS_SECRET || undefined,
        };

        // Безопасная обработка возможного редиректа (302/303) без потери тела POST
        try {
          const first = await fetch(SHEETS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            redirect: 'manual',
          });

          if (isRedirect(first.status)) {
            const loc = first.headers.get('location');
            if (loc) {
              const finalUrl = new URL(loc, SHEETS_URL).toString();
              await fetch(finalUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              }).catch(() => null);
            }
          }
        } catch {
          // тихо игнорируем — пользователю всё равно отправим «Thanks», чтобы UX был гладким
        }
      }

      await api('sendMessage', { chat_id, text: 'Thanks! Your email is saved. You can continue in the Mini App 🎉' });
      return json({ ok: true });
    }

    return json({ ok: true });
  } catch {
    // Не возвращаем 5xx чтобы не было ретраев
    return json({ ok: true });
  }
}

/* helpers */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}
async function safeJson(req) {
  try { return await req.json(); } catch { return {}; }
}
function isRedirect(code) {
  return code === 301 || code === 302 || code === 303 || code === 307 || code === 308;
}
