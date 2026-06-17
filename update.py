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


# ------------------------------- YOUTUBE ------------------------------------
def build_videos():
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={YOUTUBE_CHANNEL_ID}"
    root = ET.fromstring(fetch(url))
    blocks = []
    for entry in root.findall("atom:entry", NS)[:MAX_VIDEOS]:
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
    root = ET.fromstring(fetch(SUBSTACK_URL.rstrip("/") + "/feed"))
    blocks = []
    for item in root.find("channel").findall("item")[:MAX_POSTS]:
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
