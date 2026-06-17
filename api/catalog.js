// Vercel serverless function — the full catalog of available content.
// GET /api/catalog  ->  { videos:[{id,title,url}], articles:[{slug,title,url,date,desc}] }
//
// Fetches YouTube + Substack feeds server-side (Vercel's egress isn't blocked by
// Substack's Cloudflare) and parses them to JSON. Both the admin panel (to show
// checkboxes) and the homepage (to render picked items) read this. Cached at the
// edge so we don't hit the feeds on every visit.

import { XMLParser } from "fast-xml-parser";

const YOUTUBE_CHANNEL_ID = "UCrH85VriB3RNzdiLI4wBRXA";
const SUBSTACK_FEED = "https://ashishjhav1.substack.com/feed";
const MAX_EACH = 30;

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

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export default async function handler(req, res) {
  const origin = req.headers.origin || "";
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allow);
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).end("method not allowed");

  try {
    const [ytXml, ssXml] = await Promise.all([
      fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${YOUTUBE_CHANNEL_ID}`,
        { headers: BROWSER_HEADERS }).then((r) => r.text()),
      fetch(SUBSTACK_FEED, { headers: BROWSER_HEADERS }).then((r) => r.text()),
    ]);

    const videos = parseVideos(ytXml).slice(0, MAX_EACH);
    const articles = parseArticles(ssXml).slice(0, MAX_EACH);

    // Edge cache: fast for visitors, fresh enough for new posts.
    res.setHeader("Cache-Control", "s-maxage=600, stale-while-revalidate=86400");
    return res.status(200).json({ videos, articles });
  } catch (_) {
    return res.status(502).json({ videos: [], articles: [], error: "feed fetch failed" });
  }
}

function toArray(x) {
  return Array.isArray(x) ? x : x ? [x] : [];
}

function text(v) {
  // fast-xml-parser may return a string, or an object for CDATA/attributed nodes.
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
