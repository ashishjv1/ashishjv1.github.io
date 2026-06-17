// Vercel serverless function — fetch an RSS feed server-side and return it.
//
// Why this exists: Substack sits behind Cloudflare, which 403s requests coming
// from GitHub Actions' datacenter IP ranges no matter what headers/TLS they use.
// The daily `update.py` job (run by GitHub Actions) therefore can't read the
// Substack feed directly. It fetches through this function instead — Vercel's
// egress IPs aren't blocked — so the Writing list stays fresh automatically.
//
// Locked to a fixed allowlist so it can't be used as an open proxy.

const ALLOWED = [
  "https://ashishjhav1.substack.com/feed",
];

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

export default async function handler(req, res) {
  const url = req.query.url;
  if (!ALLOWED.includes(url)) {
    return res.status(400).end("url not allowed");
  }
  try {
    const upstream = await fetch(url, { headers: BROWSER_HEADERS });
    const body = await upstream.text();
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "s-maxage=300");
    return res.status(upstream.status).send(body);
  } catch (_) {
    return res.status(502).end("upstream fetch failed");
  }
}
