// Vercel serverless function — record an event (page view or link click).
// POST /api/track   body: {"type":"view"} or {"type":"click","label":"…"}
//
// Storage: Upstash Redis (atomic INCR). Env vars UPSTASH_REDIS_REST_URL and
// UPSTASH_REDIS_REST_TOKEN are set automatically by the Vercel + Upstash
// integration. See analytics/README.md.

import { Redis } from "@upstash/redis";

// Only accept beacons from your live site.
const ALLOWED_ORIGINS = [
  "https://ashishjv1.github.io",
  "http://localhost:8000", // local testing; harmless to leave
];

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

  const key =
    body.type === "click" && body.label
      ? "click:" + String(body.label).replace(/\s+/g, " ").trim().slice(0, 120)
      : "view";

  // Atomic increment, and remember the key so /api/stats can enumerate them.
  await Promise.all([redis.incr(key), redis.sadd("keys", key)]);

  return res.status(200).end("ok");
}
