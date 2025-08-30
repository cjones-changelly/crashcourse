// api/subscribe.js
export const config = { runtime: 'edge' };

export default async function handler(req) {
  // CORS
  if (req.method === 'OPTIONS') return cors(204);
  if (req.method !== 'POST')    return json({ ok:false, error:'method not allowed' }, 405);

  let body = {};
  try { body = await req.json(); } catch { return json({ ok:false, error:'bad json' }, 400); }

  const email = (body.email || '').toString().trim();
  if (!email) return json({ ok:false, error:'email required' }, 400);

  const SHEETS_URL    = process.env.SHEETS_URL;       // https://script.google.com/macros/s/<ID>/exec
  const SHEETS_SECRET = process.env.SHEETS_SECRET;     // если включили в Apps Script
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
    const first = await fetch(SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
      redirect: 'manual',
    });

    if (isRedirect(first.status)) {
      const loc = first.headers.get('location');
      if (!loc) return json({ ok:false, error:'redirect without location' }, 502);
      const finalUrl = new URL(loc, SHEETS_URL).toString();
      const second = await fetch(finalUrl, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify(payload),
      });
      if (!second.ok) return json({ ok:false, error:`sheets ${second.status}: ${await second.text()}` }, 502);
    } else {
      if (!first.ok) return json({ ok:false, error:`sheets ${first.status}: ${await first.text()}` }, 502);
    }
  } catch (e) {
    return json({ ok:false, error:String(e) }, 502);
  }

  return json({ ok:true });
}

/* helpers */
function json(obj, status=200){
  return new Response(JSON.stringify(obj), {
    status,
    headers:{
      'content-type':'application/json; charset=utf-8',
      'access-control-allow-origin':'*',
      'access-control-allow-headers':'content-type',
      'access-control-allow-methods':'POST,OPTIONS'
    }
  });
}
function cors(status=204){
  return new Response(null, { status, headers:{
    'access-control-allow-origin':'*',
    'access-control-allow-headers':'content-type',
    'access-control-allow-methods':'POST,OPTIONS'
  }});
}
function isRedirect(c){ return c===301||c===302||c===303||c===307||c===308; }
