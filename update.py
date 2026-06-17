#!/usr/bin/env python3
"""
Refresh the Videos (YouTube) and Writing (Substack) lists in index.html from
their public RSS feeds. Only the regions between the AUTO-* markers are touched;
everything else in the page is left exactly as written.

Run locally:   python update.py
In CI:         executed daily by .github/workflows/update.yml

Standard library only — no pip install needed.
"""

import html
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

# ----------------------------- CONFIG ---------------------------------------
YOUTUBE_CHANNEL_ID = "UCrH85VriB3RNzdiLI4wBRXA"   # Convergence
SUBSTACK_URL       = "https://ashishjhav1.substack.com"
MAX_VIDEOS         = 6
MAX_POSTS          = 6
SUBSTACK_LABEL     = "Substack"   # shown in the colored .src tag
INDEX_FILE         = "index.html"

# Substack's Cloudflare blocks GitHub Actions IPs, so the Substack feed is
# fetched through this Vercel proxy (see api/feed.js). Leave empty to fetch
# Substack directly (works from un-blocked networks like a local machine).
FEED_PROXY = "https://portfolio-api-two-rho.vercel.app/api/feed?url="

# ---------------------------- WHAT TO SHOW ----------------------------------
# Curate exactly which posts / videos appear, in the order you list them.
# Leave a list EMPTY to fall back to "latest N" automatically.
#
# WRITING_PICKS: Substack post slugs — the part after "/p/" in the post URL.
#   e.g. https://ashishjhav1.substack.com/p/the-last-conversation  ->  "the-last-conversation"
# VIDEO_PICKS: YouTube video IDs — the part after "youtu.be/" or "?v=".
#   e.g. https://youtu.be/7aJP_FBPJSM  ->  "7aJP_FBPJSM"
#
# Example (uncomment and edit to pin specific items):
# WRITING_PICKS = ["the-last-conversation", "everyone-talks-about-post-training"]
# VIDEO_PICKS   = ["7aJP_FBPJSM", "P8LoXOeQDJ8"]
WRITING_PICKS = []
VIDEO_PICKS   = []
# ----------------------------------------------------------------------------
# ----------------------------------------------------------------------------

NS = {
    "atom":  "http://www.w3.org/2005/Atom",
    "media": "http://search.yahoo.com/mrss/",
}

YT_ICON = ('<svg class="yt-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="'
           'M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.5 12 3.5 12 3.5s-7.5 0-9.4.6A3 3 '
           '0 0 0 .5 6.2 31 31 0 0 0 0 12a31 31 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c'
           '1.9.6 9.4.6 9.4.6s7.5 0 9.4-.6a3 3 0 0 0 2.1-2.1A31 31 0 0 0 24 12a'
           '31 31 0 0 0-.5-5.8zM9.6 15.6V8.4l6.2 3.6-6.2 3.6z"/></svg>')


# Substack sits behind Cloudflare, which 403s requests that don't look like a
# real browser. Send a full browser-style header set so CI fetches succeed.
BROWSER_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
}


def fetch(url):
    req = urllib.request.Request(url, headers=BROWSER_HEADERS)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def month_year(dt):
    return dt.strftime("%b %Y")  # e.g. "May 2026"


def dedash(text):
    """Replace en/em dashes (with surrounding spaces) with a comma; keep hyphens."""
    return re.sub(r"\s*[–—]\s*", ", ", text or "")


def clean(text, limit=170):
    """Strip HTML tags, collapse whitespace, drop dashes, truncate on a word boundary."""
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = html.unescape(text)
    text = dedash(text)
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > limit:
        text = text[:limit].rsplit(" ", 1)[0].rstrip(".,;: ") + "…"
    return text


def esc(s):
    return html.escape(s or "", quote=True)


def post_slug(link):
    """Extract a Substack post slug ('the-last-conversation') from its URL."""
    m = re.search(r"/p/([^/?#]+)", link or "")
    return m.group(1) if m else (link or "")


def select(entries, picks, key_fn, limit):
    """Pick exactly the items named in `picks` (in that order) when given;
    otherwise fall back to the first `limit` entries (latest-first)."""
    if not picks:
        return entries[:limit]
    by_key = {key_fn(e): e for e in entries}
    chosen = []
    for p in picks:
        if p in by_key:
            chosen.append(by_key[p])
        else:
            print(f"[warn] pick not found in feed (skipped): {p}", file=sys.stderr)
    return chosen


# ------------------------------- YOUTUBE ------------------------------------
def build_videos():
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={YOUTUBE_CHANNEL_ID}"
    root = ET.fromstring(fetch(url))
    YT = {"yt": "http://www.youtube.com/xml/schemas/2015"}
    entries = root.findall("atom:entry", NS)
    chosen = select(entries, VIDEO_PICKS,
                    lambda e: e.findtext("yt:videoId", default="", namespaces=YT),
                    MAX_VIDEOS)
    blocks = []
    for entry in chosen:
        vid   = entry.findtext("yt:videoId", default="", namespaces={"yt": "http://www.youtube.com/xml/schemas/2015"})
        title = entry.findtext("atom:title", default="", namespaces=NS)
        link  = f"https://youtu.be/{vid}" if vid else entry.find("atom:link", NS).get("href")
        blocks.append(
            f'      <a class="entry vid" href="{esc(link)}" target="_blank" rel="noopener">\n'
            f'        {YT_ICON}\n'
            f'        <span class="title">{esc(dedash(title))}</span>\n'
            f'      </a>'
        )
    return "\n".join(blocks)


# ------------------------------- SUBSTACK -----------------------------------
def build_writing():
    feed_url = SUBSTACK_URL.rstrip("/") + "/feed"
    if FEED_PROXY:
        feed_url = FEED_PROXY + urllib.parse.quote(feed_url, safe="")
    root = ET.fromstring(fetch(feed_url))
    items = root.find("channel").findall("item")
    chosen = select(items, WRITING_PICKS, lambda it: post_slug(it.findtext("link", default="")), MAX_POSTS)
    blocks = []
    for item in chosen:
        title = item.findtext("title", default="")
        link  = item.findtext("link", default="")
        desc  = clean(item.findtext("description", default=""))
        try:
            dt = parsedate_to_datetime(item.findtext("pubDate"))
        except Exception:
            dt = datetime.now(timezone.utc)
        blocks.append(
            f'      <a class="entry" href="{esc(link)}" target="_blank" rel="noopener">\n'
            f'        <p class="meta"><span class="src substack">{esc(SUBSTACK_LABEL)}</span> · {month_year(dt)}</p>\n'
            f'        <p class="title">{esc(dedash(title))}</p>\n'
            f'        <p class="desc">{esc(desc)}</p>\n'
            f'      </a>'
        )
    return "\n\n".join(blocks)


def replace_region(text, name, new_inner):
    pattern = re.compile(
        rf"(<!-- AUTO-{name}:START[^>]*-->\n).*?(\n\s*<!-- AUTO-{name}:END -->)",
        re.DOTALL,
    )
    if not pattern.search(text):
        raise SystemExit(f"Markers AUTO-{name}:START/END not found in {INDEX_FILE}")
    return pattern.sub(lambda m: m.group(1) + new_inner + m.group(2), text)


def main():
    with open(INDEX_FILE, encoding="utf-8") as f:
        html_text = f.read()

    original = html_text
    try:
        html_text = replace_region(html_text, "VIDEOS", build_videos())
        print("[ok] videos updated")
    except Exception as e:
        print(f"[skip] videos: {e}", file=sys.stderr)
    try:
        html_text = replace_region(html_text, "WRITING", build_writing())
        print("[ok] writing updated")
    except Exception as e:
        print(f"[skip] writing: {e}", file=sys.stderr)

    if html_text != original:
        with open(INDEX_FILE, "w", encoding="utf-8") as f:
            f.write(html_text)
        print("index.html written")
    else:
        print("no changes")


if __name__ == "__main__":
    main()
