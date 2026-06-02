# Portfolio

A single-file personal homepage. Everything lives in `index.html` — no build step.

## Edit your content

Open `index.html` and look for the `EDIT` / `[bracketed]` / `YOUR_...` markers:

- **Header** — your name, tagline, and photo. The photo always loads `avatar.png`; to
  change it, just save a new square image over `avatar.png` (same name) — no code changes.
- **About** — the two intro paragraphs (plain text, no photos).
- **About** — the two intro paragraphs.
- **About** — the two intro paragraphs.
- **Publications** — one `<li>` block per paper (manual; copy a block to add one).
- **Writing** / **Videos** — auto-updated (see below). To edit by hand, change the entries
  between the `AUTO-WRITING` / `AUTO-VIDEOS` markers; they'll be overwritten on the next run.
- **`<title>` / `<meta>`** at the top — used by Google and link previews.

## Auto-updating Writing & Videos

`update.py` pulls your latest YouTube and Substack posts from their RSS feeds and rewrites
only the regions between the `AUTO-VIDEOS` / `AUTO-WRITING` markers in `index.html`.
Everything else (About, Publications, styling) is left untouched.

- **Runs automatically** every day via `.github/workflows/update.yml`, which commits any
  change back to the repo. You can also trigger it anytime from the repo's **Actions** tab
  (→ *Update feeds* → *Run workflow*).
- **Run it locally** to preview: `python update.py` (standard library only — no installs).
- **Config** (channel ID, Substack URL, how many items to show) is at the top of `update.py`.

Note: descriptions come straight from the feeds, so they read however your post/video
summaries are written. Publications are intentionally **not** automated — Google Scholar
has no API and blocks scraping, and you'll want manual control of author order and venues.

## Updating your CV

The **CV** button always points to `cv.pdf`. To publish a new version, just save your
updated PDF over the existing `cv.pdf` (same filename) and push it — no code changes:

```sh
# replace cv.pdf in this folder, then:
git add cv.pdf
git commit -m "Update CV"
git push
```

Colors live in the `:root` block in the `<style>` tag (light + dark mode auto-switch).

## Deploy to GitHub Pages

1. Create a repo. For the URL `https://USERNAME.github.io`, name it exactly `USERNAME.github.io`.
   (Any other name works too — it just lives at `https://USERNAME.github.io/REPO/`.)
2. Push these files:
   ```sh
   git init
   git add .
   git commit -m "Initial portfolio"
   git branch -M main
   git remote add origin https://github.com/USERNAME/REPO.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`**.
4. Wait ~1 minute, then visit your URL.

`.nojekyll` tells GitHub to serve the files as-is (no Jekyll processing).
