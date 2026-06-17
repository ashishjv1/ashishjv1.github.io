# Portfolio analytics

Counts **profile views** and **link clicks**, shows a **views-by-day** chart and a
**recent-activity** feed, all on a private dashboard at `/admin.html`. The site
stays on GitHub Pages; the data backend runs on **Vercel** (serverless functions)
with **Upstash Redis** for storage.

Why a backend at all? GitHub Pages is static — it can't store numbers. The site
sends anonymous beacons to two Vercel functions; the dashboard reads them back
behind a password.

```
ashishjv1.github.io ──beacon──▶ /api/track ──▶ Upstash Redis (atomic INCR)
ashishjv1.github.io/admin.html ──token──▶ /api/stats ◀── Upstash Redis
```

Counters use Redis `INCR`, so they're exact even under concurrent traffic.

## Files

- `api/track.js` — records a view or click (`POST /api/track`).
- `api/stats.js` — returns all counters, token-protected (`GET /api/stats`).
- `package.json` — declares the `@upstash/redis` dependency Vercel installs.
- `admin.html`, analytics `<script>` in `index.html` — the front end.

## One-time setup (~15 min)

You need your Vercel account. The functions live in this same repo under `api/`.

1. **Import the repo into Vercel.** Vercel dashboard → *Add New… → Project* →
   import `ashishjv1/ashishjv1.github.io`. Zero config — it auto-detects the
   `api/` functions. Name the project something like `portfolio-api`.

2. **Create an Upstash Redis database.** Two routes — pick whichever you can find:

   **a) Direct (recommended, least fiddly).** Go to <https://console.upstash.com>,
   sign in (GitHub login works), *Create Database → Redis*, choose a region near
   your Vercel functions and the free tier. On the database page open the
   **REST API** section and copy `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN`. You'll paste these into Vercel in the next step.

   **b) Via Vercel.** Project (or team) → *Storage* → *Create Database* →
   *Marketplace Database Providers* → **Upstash**. This connects it and adds the
   two env vars automatically. (Vercel moves this around; if it's not in the
   project's Storage tab, look in the team-level top nav. If you can't find it,
   use route (a).)

3. **Set the env vars.** Project → *Settings → Environment Variables*. If you used
   route (a), add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from
   Upstash. Either way, also add `ADMIN_TOKEN` = any strong string you choose
   (this is the dashboard password). Redeploy so they take effect — these two
   names are exactly what `Redis.fromEnv()` reads.

4. **Grab the project URL,** e.g. `https://portfolio-api.vercel.app`.

5. **Plug the URL into the site.** Replace `YOUR-PROJECT` (two places):
   - `index.html` → the `ENDPOINT` constant in the analytics `<script>`
   - `admin.html` → `window.ANALYTICS_ENDPOINT`

   Confirm the `ALLOWED_ORIGINS` list at the top of `api/track.js` and
   `api/stats.js` matches your live site URL, then commit and push. Until the URL
   is filled in, tracking is completely inert.

## Using it

- Open `https://ashishjv1.github.io/admin.html`, enter your `ADMIN_TOKEN`, and
  you'll see total views and a ranked list of link clicks.
- The token is held only in that browser tab's session (`sessionStorage`).

## Local development (optional)

```bash
npm install
npx vercel dev          # serves /api locally; set env vars in a .env file
```

## What's captured

Per event, stored in Redis (`events`, last 500), plus lifetime and per-day counters:

- timestamp
- coarse **country / city** from Vercel's `x-vercel-ip-*` geo headers
- **referrer** reduced to a bare hostname (e.g. `linkedin.com`, `direct`, `internal`)
- **device / browser** family parsed from the user-agent

The **raw IP address is never stored** — only the country/city Vercel derives from
it. There are no cookies and no per-person identifiers, so the dashboard shows
*where/when/how* traffic arrives, never *who*.

## Notes & limits

- **Privacy:** no cookies, no raw IPs, no names — just counters and coarse,
  non-identifying signals. Because city/country is location data, add a short
  privacy note to the site if you're in a GDPR-style jurisdiction.
- **Time zones:** per-day buckets use **UTC**; the activity feed renders each
  timestamp in the viewer's local time.
- **Click labels** come from each link's visible text. For a custom label, add
  `data-track="whatever"` to the `<a>` in `index.html`.
- **Free tiers:** Vercel Hobby + Upstash free database comfortably cover a
  personal site.
- `admin.html` is `noindex` and password-gated, but the file itself is public
  (anyone can open the login). The data behind it is protected by the token.
