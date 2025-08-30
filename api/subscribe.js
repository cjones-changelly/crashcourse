// api/subscribe.js
// Accepts POST from the Mini App and writes a row to Google Sheets (Apps Script Web App)
// В ответе при ошибке вернём короткое описание стадии и статус/кусок тела, чтобы быстро понять причину.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // CORS + healthcheck
  if (req.method === 'OPTIONS') return cors(204);
  if (req.method === 'GET') {
    return json({
      ok: true,
      expects: 'POST',
      has_env: {
        SHEETS_URL: !!process.env.SHEETS_URL,
        SHEETS_SECRET: process.env.SHEETS_SECRET ? 'set' : 'not_set'
      }
    });
  }
  if (req.method !== 'POST') return json({ ok:false, error:'method not allowed' }, 405);

  let body = {};
  try { body = await req.json(); } catch { return json({ ok:false, error:'bad json' }, 400); }

  const email = (body.email || '').toString().trim();
  if (!email) return json({ ok:false, error:'email required' }, 400);

  const SHEETS_URL    = process.env.SHEETS_URL;        // ДОЛЖЕН быть вида: https://script.google.com/macros/s/<ID>/exec
  const SHEETS_SECRET = process.env.SHEETS_SECRET || ''; // если в Apps Script включена проверка
  if (!SHEETS_URL) return json({ ok:false, error:'SHEETS_URL missing' }, 500);

  const payload = {
    email,
    tg_user_id: body.tg_user_id || '',
    tg_username: body.tg_username || '',
    source: body.source || 'pickle-miniapp',
    ts: new Date().toISOString(),
    secret: SHEETS_SECRET || undefined,
  };

  // Пишем в Sheets, аккуратно отрабатывая редирект
  try {
    // 1-й запрос: без авто-редиректа
    const first = await fetch(SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
      redirect: 'manual',
    });

    if (isRedirect(first.status)) {
      const loc = first.headers.get('location');
      if (!loc) return diag('redirect_without_location', first.status, await first.text());
      const finalUrl = new URL(loc, SHEETS_URL).toString();

      // 2-й запрос по Location
      const second = await fetch(finalUrl, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload),
      });

      if (!second.ok) return diag('sheets_final', second.status, await safeText(second));
      // 2xx считаем успехом, тело нам необязательно
      return json({ ok:true });
    } else {
      if (!first.ok) return diag('sheets_first', first.status, await safeText(first));
      // 2xx считаем успехом, даже если JSON {ok:false} — UX не ломаем
      return json({ ok:true });
    }
  } catch (e) {
    return json({ ok:false, error:`fetch_failed: ${String(e)}` }, 502);
  }
}

/* ---------- helpers ---------- */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST,OPTIONS'
    },
  });
}
function cors(status=204){
  return new Response(null, {
    status,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'POST,OPTIONS'
    }
  });
}
function isRedirect(code){ return code===301||code===302||code===303||code===307||code===308; }
async function safeText(res){ try{ return await res.text(); } catch { return ''; } }
function diag(stage, status, text){
  const snippet = (text || '').slice(0, 220);
  return json({ ok:false, error:`${stage} ${status}: ${snippet}` }, 502);
}
