// Vercel serverless function — return everything the dashboard needs.
// GET /api/stats   header: X-Admin-Token: <ADMIN_TOKEN>   (or ?token=…)
//
// Returns:
//   { totals:{views,clicks}, clicksByLabel:{label:n},
//     daily:{ "YYYY-MM-DD": {views,clicks} }, events:[ {…}, … ] }
// See analytics/README.md.

import { Redis } from "@upstash/redis";

const ALLOWED_ORIGINS = [
  "https://ashishjv1.github.io",
  "http://localhost:8000",
];

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "X-Admin-Token");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).end("method not allowed");

  const token = req.headers["x-admin-token"] || req.query.token;
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).end("unauthorized");
  }

  const [keys, viewsDaily, clicksDaily, events] = await Promise.all([
    redis.smembers("keys"),
    redis.hgetall("views:daily"),
    redis.hgetall("clicks:daily"),
    redis.lrange("events", 0, 99),
  ]);

  // Lifetime counters -> totals + per-label click breakdown.
  const clicksByLabel = {};
  let views = 0;
  let clicks = 0;
  if (keys.length) {
    const values = await redis.mget(...keys);
    keys.forEach((k, i) => {
      const n = Number(values[i]) || 0;
      if (k === "view") views = n;
      else if (k.indexOf("click:") === 0) {
        clicksByLabel[k.slice(6)] = n;
        clicks += n;
      }
    });
  }

  // Merge the two daily hashes into one date-keyed object.
  const daily = {};
  const merge = (hash, field) => {
    Object.keys(hash || {}).forEach((date) => {
      if (!daily[date]) daily[date] = { views: 0, clicks: 0 };
      daily[date][field] = Number(hash[date]) || 0;
    });
  };
  merge(viewsDaily, "views");
  merge(clicksDaily, "clicks");

  // Upstash deserializes stored objects; tolerate either object or JSON string.
  const cleanEvents = (events || []).map((e) => {
    if (typeof e === "string") {
      try { return JSON.parse(e); } catch (_) { return null; }
    }
    return e;
  }).filter(Boolean);

  return res.status(200).json({
    totals: { views, clicks },
    clicksByLabel,
    daily,
    events: cleanEvents,
  });
}
