/**
 * ResearchDesk worker
 *  - serves the static site
 *  - rewrites /company/*, /sector/*, /sectors, /screens to index.html
 *  - proxies /api/ltp so the Upstox token never reaches the browser
 */

const UPSTOX_BASE = "https://api.upstox.com/v2/market-quote/ltp";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // ---- live price proxy -------------------------------------------------
    if (path === "/api/ltp") {
      const isin = (url.searchParams.get("isin") || "").trim();
      if (!/^IN[A-Z0-9]{10}$/.test(isin)) {
        return json({ error: "bad isin" }, 400);
      }
      if (!env.UPSTOX_TOKEN) {
        return json({ error: "not configured" }, 503);
      }

      const cache = caches.default;
      const key = new Request(url.origin + "/api/ltp?isin=" + isin, request);
      const hit = await cache.match(key);
      if (hit) return hit;

      try {
        const r = await fetch(
          `${UPSTOX_BASE}?instrument_key=${encodeURIComponent("NSE_EQ|" + isin)}`,
          { headers: { Authorization: `Bearer ${env.UPSTOX_TOKEN}`, Accept: "application/json" } }
        );
        if (!r.ok) return json({ error: "upstream " + r.status }, 502);
        const j = await r.json();
        const first = Object.values(j.data || {})[0] || null;
        const out = json(
          { ltp: first ? first.last_price : null, ts: Date.now() },
          200,
          { "cache-control": "public, max-age=60" }
        );
        ctx.waitUntil(cache.put(key, out.clone()));
        return out;
      } catch (e) {
        return json({ error: "fetch failed" }, 502);
      }
    }

    // ---- app routes -> index.html -----------------------------------------
    const isAppRoute =
      /^\/company\/[^/]+$/.test(path) ||
      /^\/sector\/[^/]+$/.test(path) ||
      path === "/sectors" ||
      path === "/screens";

    if (isAppRoute) {
      const res = await env.ASSETS.fetch(new URL("/index.html", url.origin));
      const body = await res.text();
      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
        },
      });
    }

    // ---- everything else: static assets -----------------------------------
    return env.ASSETS.fetch(request);
  },
};

function json(obj, status = 200, extra = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });
}
