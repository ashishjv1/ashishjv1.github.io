// Vercel serverless function — record an event (page view or link click).
// POST /api/track   body: {"type":"view"} or {"type":"click","label":"…"}, optional "ref"
//
// Stores, in Upstash Redis:
//   - lifetime counters:  view , click:<label>            (INCR)
//   - per-day counters:    views:daily / clicks:daily       (HINCRBY by UTC date)
//   - recent activity log: events (last 500)                (LPUSH + LTRIM)
//
// Captured per event: timestamp, coarse country/city (Vercel geo headers),
// referrer hostname, and device/browser (parsed from user-agent).
// The raw IP address is never stored. See analytics/README.md.

import { Redis } from "@upstash/redis";

const ALLOWED_ORIGINS = [
  "https://ashishjv1.github.io",
  "http://localhost:8000", // local testing; harmless to leave
];

const OWN_HOSTS = ["ashishjv1.github.io", "localhost"];
const EVENTS_KEY = "events";
const EVENTS_MAX = 500;

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end("method not allowed");

  // Beacons arrive as text/plain; body may be a string.
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  const type = body.type === "click" ? "click" : "view";
  const label =
    type === "click" && body.label
      ? String(body.label).replace(/\s+/g, " ").trim().slice(0, 120)
      : "";

  const now = new Date();
  const day = now.toISOString().slice(0, 10); // UTC date, e.g. 2026-06-17
  const ua = parseUA(req.headers["user-agent"]);

  const event = {
    t: now.getTime(),
    type,
    label,
    ref: refHost(body.ref),
    country: (req.headers["x-vercel-ip-country"] || "").toString().toUpperCase() || "?",
    city: decodeHeader(req.headers["x-vercel-ip-city"]),
    device: ua.device,
    browser: ua.browser,
  };

  const counterKey = type === "click" && label ? "click:" + label : "view";
  const dailyKey = type === "click" ? "clicks:daily" : "views:daily";

  await Promise.all([
    redis.incr(counterKey),
    redis.sadd("keys", counterKey),
    redis.hincrby(dailyKey, day, 1),
    redis.lpush(EVENTS_KEY, event),
    redis.ltrim(EVENTS_KEY, 0, EVENTS_MAX - 1),
  ]);

  return res.status(200).end("ok");
}

function decodeHeader(v) {
  if (!v) return "";
  try { return decodeURIComponent(String(v)); } catch (_) { return String(v); }
}

// Map a referrer URL to a bare hostname ("linkedin.com"), "direct", or "internal".
function refHost(ref) {
  if (!ref) return "direct";
  try {
    const host = new URL(ref).hostname.replace(/^www\./, "");
    return OWN_HOSTS.includes(host) ? "internal" : host;
  } catch (_) {
    return "other";
  }
}

// Coarse device + browser family from the user-agent string.
function parseUA(uaRaw) {
  const ua = uaRaw || "";
  let device = "desktop";
  if (/bot|crawl|spider|slurp|bingpreview|facebookexternalhit/i.test(ua)) device = "bot";
  else if (/tablet|ipad/i.test(ua)) device = "tablet";
  else if (/mobi|android|iphone|ipod/i.test(ua)) device = "mobile";

  let browser = "Other";
  if (/edg/i.test(ua)) browser = "Edge";
  else if (/opr|opera/i.test(ua)) browser = "Opera";
  else if (/chrome|crios/i.test(ua)) browser = "Chrome";
  else if (/firefox|fxios/i.test(ua)) browser = "Firefox";
  else if (/safari/i.test(ua)) browser = "Safari";

  return { device, browser };
}
