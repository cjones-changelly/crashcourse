// api/telegram-webhook.js
// Vercel Edge Function: Telegram webhook → Google Sheets (Apps Script Web App) + чатовая отладка

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // --- 1) Проверка секрета от Telegram (задаётся в setWebhook секретом secret_token=...) ---
  const expected = process.env.TG_WEBHOOK_SECRET;
  const got = req.headers.get('x-telegram-bot-api-secret-token');
  if (expected && got !== expected) {
    return j({ ok: false, error: 'forbidden' }, 403);
  }

  // Разрешаем только POST от Telegram. На GET/прочее отвечаем 200, чтобы не плодить ретраи.
  if (req.method !== 'POST') {
    return j({ ok: true, info: 'telegram webhook up' }, 200);
  }

  const BOT_TOKEN = process.env.BOT_TOKEN;
  if (!BOT_TOKEN) return j({ ok: false, error: 'BOT_TOKEN missing' }, 500);

  const DEBUG_TO_CHAT = process.env.DEBUG_TO_CHAT === '1';

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
    // --- 2) /start: присылаем кнопку открытия миниапа (web_app) ---
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
      return j({ ok: true });
    }

    // --- 3) Данные из WebApp (sendData) ---
    const wad = msg?.web_app_data?.data;
    if (wad && chat_id) {
      const from = msg.from || {};
      let email = null;
      let source = 'pickle-miniapp';

      try {
        const parsed = JSON.parse(wad);
        email = String(parsed.email || '').trim();
        source = parsed.source || source;
      } catch (_) {}

      if (!email) {
        await api('sendMessage', { chat_id, text: 'Could not read your email. Please try again.' });
        return j({ ok: true });
      }

      // --- 4) Отправляем строку в Google Sheets через Apps Script Web App ---
      const SHEETS_URL = process.env.SHEETS_URL;         // РЕКОМЕНДОВАНО: https://script.google.com/macros/s/<ID>/exec
      const SHEETS_SECRET = process.env.SHEETS_SECRET;   // если включили защиту в Apps Script
      let debugMsg = 'no SHEETS_URL';

      if (SHEETS_URL) {
        const payload = {
          email,
          tg_user_id: from.id || '',
          tg_username: from.username || '',
          source,
          ts: new Date().toISOString(),
          secret: SHEETS_SECRET || undefined,
        };

        // Надёжный POST: сначала пробуем без авто-редиректа, чтобы не потерять тело при 302/303
        try {
          const first = await fetch(SHEETS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            redirect: 'manual', // <— важно: сами обработаем редирект
          });

          if (isRedirect(first.status)) {
            const loc = first.headers.get('location');
            if (!loc) throw new Error('redirect-without-location');
            // Строим абсолютную ссылку на случай относительного Location
            const finalUrl = new URL(loc, SHEETS_URL).toString();

            const second = await fetch(finalUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });

            const txt2 = await second.text();
            debugMsg = `Sheets(redirected): ${second.status} ${trim(txt2, 200)}`;
          } else {
            const txt1 = await first.text();
            debugMsg = `Sheets: ${first.status} ${trim(txt1, 200)}`;
          }
        } catch (err) {
          debugMsg = `Sheets error: ${String(err)}`;
        }
      }

      // --- 5) Ответ пользователю (и отладка в чат при DEBUG_TO_CHAT=1) ---
      let text = 'Thanks! Your email is saved. You can continue in the Mini App 🎉';
      if (DEBUG_TO_CHAT) text += `\n\n${debugMsg}`;
      await api('sendMessage', { chat_id, text });

      return j({ ok: true });
    }

    // --- Прочие апдейты просто подтверждаем ---
    return j({ ok: true });
  } catch (e) {
    // Не отдаём Telegram 5xx — чтобы не копились ретраи
    if (chat_id && DEBUG_TO_CHAT) {
      await api('sendMessage', { chat_id, text: `Webhook error: ${String(e)}` }).catch(() => null);
    }
    return j({ ok: true, warn: String(e) });
  }
}

/* ---------- helpers ---------- */
function j(obj, status = 200) {
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
function trim(s, n) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}
