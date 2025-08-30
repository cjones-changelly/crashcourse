// api/subscribe.js
// POST из миниапа -> Apps Script Web App (/exec). Любой 2xx/3xx считаем успехом.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // CORS + healthcheck
  if (req.method === 'OPTIONS') return cors(204);
  if (req.method === 'GET') {
    const u = process.env.SHEETS_URL || '';
    return json({
      ok: true,
      expects: 'POST',
      has_env: { SHEETS_URL: !!u, SHEETS_SECRET: process.env.SHEETS_SECRET ? 'set' : 'not_set' }
    });
  }
  if (req.method !== 'POST') return json({ ok:false, error:'method not allowed' }, 405);

  // тело
  let body = {};
  try { body = await req.json(); } catch { return json({ ok:false, error:'bad json' }, 400); }
  const email = (body.email || '').toString().trim();
  if (!email) return json({ ok:false, error:'email required' }, 400);

  // env
  const SHEETS_URL    = process.env.SHEETS_URL;        // строго: https://script.google.com/macros/s/<ID>/exec
  const SHEETS_SECRET = process.env.SHEETS_SECRET || ''; // если включен секрет в Apps Script
  if (!SHEETS_URL) return json({ ok:false, error:'SHEETS_URL missing' }, 500);

  const payload = {
    email,
    tg_user_id: body.tg_user_id || '',
    tg_username: body.tg_username || '',
    source: body.source || 'pickle-miniapp',
    ts: new Date().toISOString(),
    secret: SHEETS_SECRET || undefined,
  };

  try {
    // Шлём на /exec и НЕ следуем редиректам — 2xx или 3xx считаем успехом
    const first = await fetch(SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
      redirect: 'manual',
    });

    if (first.ok) return json({ ok:true });
    if (isRedirect(first.status)) return json({ ok:true }); // Apps Script принял запрос — считаем успехом

    // Иначе — короткая диагностика
    const t = await safeText(first);
    return json({ ok:false, error:`sheets ${first.status}: ${t.slice(0,180)}` }, 502);
  } catch (e) {
    return json({ ok:false, error:`fetch_failed: ${String(e)}` }, 502);
  }
}

/* helpers */
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
