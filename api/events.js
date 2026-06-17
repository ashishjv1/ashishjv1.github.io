// Vercel serverless function — manage the recent-activity log (admin only).
// POST /api/events  body: { ids:[…] }  -> delete those events
// POST /api/events  body: { all:true }  -> clear the whole log
//
// Requires X-Admin-Token. The log lives in the Upstash list "events".

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
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).end("method not allowed");

  const token = req.headers["x-admin-token"];
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return res.status(401).end("unauthorized");
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = {}; }
  }
  body = body || {};

  if (body.all === true) {
    await redis.del("events");
    return res.status(200).json({ ok: true, cleared: true });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((s) => typeof s === "string") : [];
  if (!ids.length) return res.status(400).json({ error: "no ids" });

  const idset = new Set(ids);
  const all = (await redis.lrange("events", 0, -1)) || [];
  const keep = all
    .map((e) => (typeof e === "string" ? safeParse(e) : e))
    .filter((e) => e && !idset.has(e.id));

  // Rewrite the list with the survivors, preserving newest-first order.
  await redis.del("events");
  if (keep.length) await redis.rpush("events", ...keep);

  return res.status(200).json({ ok: true, removed: all.length - keep.length, remaining: keep.length });
}

function safeParse(s) {
  try { return JSON.parse(s); } catch (_) { return null; }
}
