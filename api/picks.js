// Vercel serverless function — the curated selection of what to show.
// GET  /api/picks  ->  { videos:[<id>…], articles:[<slug>…] }   (public, always fresh)
// POST /api/picks  body: { videos:[…], articles:[…] }           (admin token required)
//
// Stored in Upstash under the key "picks". The homepage reads this to decide
// which catalog items to render; the admin panel writes it.

import { Redis } from "@upstash/redis";

const ALLOWED_ORIGINS = [
  "https://ashishjv1.github.io",
  "http://localhost:8000",
];

const EMPTY = { videos: [], articles: [], repos: [] };
const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Admin-Token");

  if (req.method === "OPTIONS") return res.status(204).end();

  // ---- read current selection (public) ----
  if (req.method === "GET") {
    const picks = (await redis.get("picks")) || EMPTY;
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json(normalize(picks));
  }

  // ---- save selection (admin only) ----
  if (req.method === "POST") {
    const token = req.headers["x-admin-token"];
    if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
      return res.status(401).end("unauthorized");
    }
    let body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body); } catch (_) { body = {}; }
    }
    const picks = normalize(body || {});
    await redis.set("picks", picks);
    return res.status(200).json(picks);
  }

  return res.status(405).end("method not allowed");
}

// Coerce to { videos:[strings], articles:[strings], repos:[strings] }, capped + de-duped.
function normalize(p) {
  const arr = (x) =>
    Array.isArray(x)
      ? [...new Set(x.filter((s) => typeof s === "string").map((s) => s.trim()).filter(Boolean))].slice(0, 50)
      : [];
  return { videos: arr(p.videos), articles: arr(p.articles), repos: arr(p.repos) };
}
