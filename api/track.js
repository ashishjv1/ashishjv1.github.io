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
    id: now.getTime().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
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

  // Fire email alerts for matching rules. Never let this break tracking.
  try { await maybeAlert(event); } catch (_) { /* ignore */ }

  return res.status(200).end("ok");
}

async function maybeAlert(event) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return; // email not configured yet
  const rules = await redis.get("alerts");
  if (!Array.isArray(rules) || !rules.length) return;

  for (const rule of rules) {
    if (!rule || rule.enabled === false || !rule.email || !matches(rule, event)) continue;
    // Throttle: at most one email per rule per 15 min, to avoid floods.
    const fresh = await redis.set("alertthrottle:" + rule.id, "1", { nx: true, ex: 900 });
    if (!fresh) continue;
    await sendEmail(key, rule.email, event);
  }
}

function matches(rule, event) {
  const v = String(rule.value || "").toLowerCase().trim();
  if (!v) return false;
  if (rule.kind === "referrer") return String(event.ref || "").toLowerCase().includes(v);
  return ((event.country || "") + " " + (event.city || "")).toLowerCase().includes(v);
}

async function sendEmail(apiKey, to, event) {
  const from = process.env.ALERT_FROM || "Portfolio <onboarding@resend.dev>";
  const where = [event.city, event.country].filter((x) => x && x !== "?").join(", ") || "unknown location";
  const via = event.ref && event.ref !== "direct" ? event.ref : "direct";
  const what = event.type === "click" ? `clicked "${event.label || "a link"}"` : "viewed your portfolio";
  const when = new Date(event.t || Date.now()).toUTCString();

  const html =
    `<p>Someone ${what}.</p>` +
    `<ul>` +
    `<li><b>Location:</b> ${esc(where)}</li>` +
    `<li><b>Source:</b> ${esc(via)}</li>` +
    `<li><b>Device:</b> ${esc((event.device || "") + (event.browser ? " · " + event.browser : ""))}</li>` +
    `<li><b>Time:</b> ${esc(when)}</li>` +
    `</ul>`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject: `Portfolio visit — ${where} via ${via}`, html }),
  });
}

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
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
