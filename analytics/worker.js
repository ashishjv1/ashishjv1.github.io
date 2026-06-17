// Cloudflare Worker — portfolio analytics
// ------------------------------------------------------------------
// Two endpoints:
//   POST /track  — public; increments a counter (a page view or a link click)
//   GET  /stats  — token-protected; returns all counters as JSON for the dashboard
//
// Bindings required (see wrangler.toml + README.md):
//   - KV namespace bound as STATS
//   - secret ADMIN_TOKEN (the password the dashboard sends)
//
// Note: counters use read-then-write, which can lose the odd increment under
// heavy concurrent traffic. That's fine for a personal site. Free-tier KV
// allows ~1,000 writes/day, i.e. ~1,000 tracked events/day.
// ------------------------------------------------------------------

// Only accept tracking beacons from your live site.
const ALLOWED_ORIGINS = [
  "https://ashishjv1.github.io",
  "http://localhost:8000", // for local testing; harmless to leave
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

    const cors = {
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token",
      "Access-Control-Max-Age": "86400",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    // ---- Record an event ----
    if (url.pathname === "/track" && request.method === "POST") {
      let body = {};
      try {
        body = JSON.parse(await request.text());
      } catch (_) {
        /* ignore malformed beacons */
      }
      const key =
        body.type === "click" && body.label
          ? "click:" + String(body.label).replace(/\s+/g, " ").trim().slice(0, 120)
          : "view";
      await bump(env.STATS, key);
      return new Response("ok", { headers: cors });
    }

    // ---- Read all counters (dashboard) ----
    if (url.pathname === "/stats" && request.method === "GET") {
      const token =
        request.headers.get("X-Admin-Token") || url.searchParams.get("token");
      if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
        return new Response("unauthorized", { status: 401, headers: cors });
      }

      const out = {};
      let cursor;
      do {
        const list = await env.STATS.list({ cursor });
        for (const entry of list.keys) {
          out[entry.name] = Number(await env.STATS.get(entry.name)) || 0;
        }
        cursor = list.cursor;
        if (list.list_complete) break;
      } while (cursor);

      return new Response(JSON.stringify(out), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    return new Response("not found", { status: 404, headers: cors });
  },
};

async function bump(kv, key) {
  const current = Number(await kv.get(key)) || 0;
  await kv.put(key, String(current + 1));
}
