// api/subscribe.js
// Robust POST → Apps Script Web App (/exec) with redirect handling (incl. HTML body with &amp; links)

export const config = { runtime: 'edge' };

export default async function handler(req) {
  // CORS + healthcheck
  if (req.method === 'OPTIONS') return cors(204);
  if (req.method === 'GET') {
    const u = process.env.SHEETS_URL || '';
    return json({
      ok: true,
      expects: 'POST',
      target_hint: u ? new URL(u).host + new URL(u).pathname : null,
      has_env: { SHEETS_URL: !!u, SHEETS_SECRET: process.env.SHEETS_SECRET ? 'set' : 'not_set' }
    });
  }
  if (req.method !== 'POST') return json({ ok:false, error:'method not allowed' }, 405);

  // body
  let body = {};
  try { body = await req.json(); } catch { return json({ ok:false, error:'bad json' }, 400); }
  const email = (body.email || '').toString().trim();
  if (!email) return json({ ok:false, error:'email required' }, 400);

  // env
  const SHEETS_URL    = process.env.SHEETS_URL;        // must be https://script.google.com/macros/s/<ID>/exec
  const SHEETS_SECRET = process.env.SHEETS_SECRET || '';
  if (!SHEETS_URL) return json({ ok:false, error:'SHEETS_URL missing' }, 500);

  // payload to Apps Script
  const payload = {
    email,
    tg_user_id: body.tg_user_id || '',
    tg_username: body.tg_username || '',
    source: body.source || 'pickle-miniapp',
    ts: new Date().toISOString(),
    secret: SHEETS_SECRET || undefined,
  };

  try {
    // 1) First POST to /exec, manual redirect
    const first = await fetch(SHEETS_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(payload),
      redirect: 'manual',
    });

    // If first already 2xx — success
    if (first.ok) return json({ ok:true });

    // If redirect — resolve final URL
    if (isRedirect(first.status)) {
      // try Location header
      let loc = first.headers.get('location') || '';
      let finalUrl = '';
      if (loc && !looksLikeDocs(loc)) {
        finalUrl = absolutize(loc, SHEETS_URL);
      } else {
        // Some proxies return HTML "Moved..." page — parse body for googleusercontent link
        const html = await safeText(first);
        const m = html.match(/https:\/\/script\.googleusercontent\.com\/macros\/echo\?[^"'<>\\]+/i);
        if (m && m[0]) {
          finalUrl = m[0].replace(/&amp;/g, '&');
        }
      }

      if (!finalUrl) return diag('redirect_no_final_url', first.status, await safeText(first));

      // 2) Second POST to finalUrl (googleusercontent)
      const second = await fetch(finalUrl, {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify(payload),
      });

      if (second.ok) return json({ ok:true });

      // If final gave 405 and looks like docs.google.com — try to salvage from body again
      const txt2 = await safeText(second);
      if (looksLikeDocs(finalUrl)) {
        const m2 = txt2.match(/https:\/\/script\.googleusercontent\.com\/macros\/echo\?[^"'<>\\]+/i);
        if (m2 && m2[0]) {
          const retryUrl = m2[0].replace(/&amp;/g, '&');
          const third = await fetch(retryUrl, {
            method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(payload)
          });
          if (third.ok) return json({ ok:true });
        }
      }
      return diag('sheets_final', second.status, txt2);
    }

    // Not ok and not redirect
    return diag('sheets_first', first.status, await safeText(first));
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
function looksLikeDocs(u){ try{ return new URL(u, 'https://x').host.includes('docs.google.com'); } catch { return false; } }
function absolutize(loc, base){ try{ return new URL(loc, base).toString(); } catch { return ''; } }
function diag(stage, status, text){
  const snippet = (text || '').slice(0, 220);
  return json({ ok:false, error:`${stage} ${status}: ${snippet}` }, 502);
}
