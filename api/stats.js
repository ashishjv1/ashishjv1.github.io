// Vercel serverless function — return all counters for the dashboard.
// GET /api/stats   header: X-Admin-Token: <ADMIN_TOKEN>   (or ?token=…)
//
// Protected by the ADMIN_TOKEN env var you set in the Vercel project.
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

  const keys = await redis.smembers("keys");
  const out = {};
  if (keys.length) {
    const values = await redis.mget(...keys);
    keys.forEach((k, i) => { out[k] = Number(values[i]) || 0; });
  }

  return res.status(200).json(out);
}
