// api/subscribe.js
// Accepts POST from the Mini App and writes a row to Google Sheets (Apps Script Web App)

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // CORS (на всякий случай)
  if (req.method === 'OPTIONS') {
    return cors(204);
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'method not allowed' }, 405);
  }

  let body = {};
  try { body = await req.json(); } catch { return json({ ok:false, error:'bad json' }, 400); }

  const email = (body.email || '').toString().trim();
  if (!email) return json({ ok:false, error:'email required' }, 400);

  const SHEETS_URL = process.env.SHEETS_URL;       // https://script.google.com/macros/s/<ID>/exec
  const SHEETS_SECRET = process.env.SHEETS_SECRET; // если включили проверку в Apps Script
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
    // Шлём POST без авто-редиректа, чтобы не потерять тело при 302/303
    const first = await fetch(SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'manual',
    });

    if (isRedirect(first.status)) {
      const loc = first.headers.get('location');
      if (!loc) return json({ ok:false, error:'redirect without location' }, 502);
      const finalUrl = new URL(loc, SHEETS_URL).toString();
      const second = await fetch(finalUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!second.ok) {
        const t = await second.text();
        return json({ ok:false, error:`sheets ${second.status}: ${t}` }, 502);
      }
      // опционально можно проверить тело second
    } else {
      if (!first.ok) {
        const t = await first.text();
        return json({ ok:false, error:`sheets ${first.status}: ${t}` }, 502);
      }
    }
  } catch (e) {
    return json({ ok:false, error:String(e) }, 502);
  }

  return json({ ok: true });
}

/* helpers */
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8',
               'access-control-allow-origin': '*',
               'access-control-allow-headers': 'content-type',
               'access-control-allow-methods': 'POST,OPTIONS' },
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
