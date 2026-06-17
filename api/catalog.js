// Vercel serverless function — the full catalog of available content.
// GET /api/catalog  ->  {
//   videos:   [{id,title,url}],
//   articles: [{slug,title,url,date,desc}],
//   repos:    [{name,full_name,desc,url,homepage,stars,language,topics}]
// }
//
// Fetches YouTube + Substack + GitHub server-side (Vercel's egress isn't blocked
// by Substack's Cloudflare) and parses them to JSON. Both the admin panel (to
// show checkboxes) and the homepage (to render picked items) read this. Cached
// at the edge so we don't hit the sources on every visit. Each source is fetched
// independently — one failing returns [] for that section without breaking the rest.

import { XMLParser } from "fast-xml-parser";

const YOUTUBE_CHANNEL_ID = "UCrH85VriB3RNzdiLI4wBRXA";
const SUBSTACK_FEED = "https://ashishjhav1.substack.com/feed";
const GITHUB_USER = "ashishjv1";
const MAX_EACH = 60;

const ALLOWED_ORIGINS = [
  "https://ashishjv1.github.io",
  "http://localhost:8000",
];

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

const GITHUB_HEADERS = {
  "User-Agent": "portfolio-catalog",
  Accept: "application/vnd.github+json",
};

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).end("method not allowed");

  const ytUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`;
  const ghUrl = `https://api.github.com/users/${GITHUB_USER}/repos?per_page=100&sort=pushed`;

  const [videos, articles, repos] = await Promise.all([
    safe(async () => parseVideos(await getText(ytUrl, BROWSER_HEADERS)).slice(0, MAX_EACH)),
    safe(async () => parseArticles(await getText(SUBSTACK_FEED, BROWSER_HEADERS)).slice(0, MAX_EACH)),
    safe(async () => parseRepos(await getJSON(ghUrl, GITHUB_HEADERS)).slice(0, MAX_EACH)),
  ]);

  res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=86400");
  return res.status(200).json({ videos, articles, repos });
}

async function safe(fn) {
  try { return await fn(); } catch (_) { return []; }
}
async function getText(url, headers) {
  const r = await fetch(url, { headers });
  return r.text();
}
async function getJSON(url, headers) {
  const r = await fetch(url, { headers });
  return r.json();
}

function toArray(x) {
  return Array.isArray(x) ? x : x ? [x] : [];
}

function text(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "#text" in v) return String(v["#text"]);
  return String(v);
}

function parseVideos(xml) {
  const feed = parser.parse(xml).feed || {};
  return toArray(feed.entry).map((e) => {
    const id = text(e["yt:videoId"]);
    return { id, title: dedash(text(e.title)), url: id ? "https://youtu.be/" + id : text(e.link?.["@_href"]) };
  }).filter((v) => v.id);
}

function parseArticles(xml) {
  const channel = (parser.parse(xml).rss || {}).channel || {};
  return toArray(channel.item).map((it) => {
    const link = text(it.link);
    const slug = (link.match(/\/p\/([^/?#]+)/) || [])[1] || link;
    return {
      slug,
      title: dedash(text(it.title)),
      url: link,
      date: monthYear(text(it.pubDate)),
      desc: clean(text(it.description)),
    };
  }).filter((a) => a.slug);
}

function parseRepos(list) {
  return (Array.isArray(list) ? list : [])
    .filter((r) => r && !r.fork)
    .map((r) => ({
      name: r.name,
      full_name: r.full_name,
      desc: dedash(r.description || ""),
      url: r.html_url,
      homepage: r.homepage || "",
      stars: r.stargazers_count || 0,
      language: r.language || "",
      topics: Array.isArray(r.topics) ? r.topics.slice(0, 4) : [],
    }))
    .filter((r) => r.name);
}

function monthYear(pubDate) {
  const d = new Date(pubDate);
  if (isNaN(d)) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function dedash(s) {
  return (s || "").replace(/\s*[–—]\s*/g, ", ");
}

function clean(s, limit = 170) {
  let t = (s || "").replace(/<[^>]+>/g, " ");
  t = t.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
       .replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ");
  t = dedash(t).replace(/\s+/g, " ").trim();
  if (t.length > limit) t = t.slice(0, limit).replace(/\s+\S*$/, "") + "…";
  return t;
}
