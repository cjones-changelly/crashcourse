// api/telegram-webhook.js
export const config = { runtime: 'edge' }; // быстрые ответы на Vercel Edge

export default async function handler(req) {
  const secret = process.env.TG_WEBHOOK_SECRET;
  const hdr = req.headers.get('x-telegram-bot-api-secret-token');
  if (secret && hdr !== secret) {
    return new Response(JSON.stringify({ ok:false, error:'bad secret' }), { status: 403 });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok:false, error:'method not allowed' }), { status: 405 });
  }

  const update = await req.json().catch(()=> ({}));
  const token = process.env.BOT_TOKEN;
  if (!token) return new Response(JSON.stringify({ ok:false, error:'BOT_TOKEN missing' }), { status: 500 });

  const api = (method, payload) =>
    fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

  const msg = update.message;

  // /start — прислать кнопку открытия миниапа
  if (msg?.text === '/start') {
    const chat_id = msg.chat.id;
    const url = process.env.MINIAPP_URL || 'https://your-app.vercel.app';
    await api('sendMessage', {
      chat_id,
      text: 'Tap the button below to open the course 👇',
      reply_markup: {
        keyboard: [
          [ { text:'Open course', web_app:{ url } } ]
        ],
        resize_keyboard: true,
        one_time_keyboard: true
      }
    });
    return new Response(JSON.stringify({ ok:true }));
  }

  // Данные из WebApp (sendData)
  const wad = msg?.web_app_data?.data;
  if (wad) {
    const chat_id = msg.chat.id;
    const from = msg.from || {};
    let email = null, source = 'pickle-miniapp';
    try {
      const parsed = JSON.parse(wad);
      email = parsed.email?.trim();
      source = parsed.source || source;
    } catch(e){}

    if (!email) {
      await api('sendMessage', { chat_id, text: 'Could not read your email. Please try again.' });
      return new Response(JSON.stringify({ ok:true }));
    }

    // ---- Пишем строку в Google Sheets (через Apps Script Web App) ----
    const SHEETS_URL = process.env.SHEETS_URL; // URL деплойнутого Apps Script Web App
    if (SHEETS_URL) {
      await fetch(SHEETS_URL, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          email,
          tg_user_id: from.id || '',
          tg_username: from.username || '',
          source,
          ts: new Date().toISOString()
        })
      }).catch(()=>null);
    }

    // Ответ пользователю
    await api('sendMessage', {
      chat_id,
      text: 'Thanks! Your email is saved. You can continue in the Mini App 🎉'
    });

    return new Response(JSON.stringify({ ok:true }));
  }

  return new Response(JSON.stringify({ ok:true }));
}
