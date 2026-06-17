// Vercel serverless function — manage email-alert rules (admin only).
// GET  /api/alerts  -> { rules:[…] }
// POST /api/alerts  body { rules:[…] }  -> save
//
// A rule: { id, kind:"location"|"referrer", value, email, enabled }
// Evaluated in api/track.js on every visit; matches send an email via Resend.
// Requires X-Admin-Token. Stored in Upstash under "alerts".

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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token");

  if (req.method === "OPTIONS") return res.status(204).end();

  const token = req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).end("unauthorized");
  }

  if (req.method === "GET") {
    const rules = (await redis.get("alerts")) || [];
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ rules: Array.isArray(rules) ? rules : [], emailConfigured: !!process.env.RESEND_API_KEY });
  }

  if (req.method === "POST") {
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    const rules = normalize((body || {}).rules);
    await redis.set("alerts", rules);
    return res.status(200).json({ rules });
  }

  return res.status(405).end("method not allowed");
}

function normalize(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.slice(0, 25).map((r) => ({
    id: typeof r.id === "string" && r.id ? r.id.slice(0, 40) : Math.random().toString(36).slice(2, 10),
    kind: r.kind === "referrer" ? "referrer" : "location",
    value: String(r.value || "").trim().slice(0, 80),
    email: String(r.email || "").trim().slice(0, 120),
    enabled: r.enabled !== false,
  })).filter((r) => r.value && /.+@.+\..+/.test(r.email));
}
