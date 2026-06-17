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

## Curating what shows on the portfolio

The dashboard's **"Show on portfolio"** section lets you tick exactly which videos,
articles, and GitHub repos appear on the homepage — no code edits.

Repo cards are built from each repo's GitHub metadata: the **description** becomes
the card text, the **language + topics** become the chips, and the repo's
**homepage** field (if set) renders as a second "Live ↗" link. So to polish a card,
edit those fields on GitHub. Leaving the Repos column empty keeps the hand-written
Selected Work cards instead of listing every repo.

```
admin.html  ──tick + Save──▶  POST /api/picks (token)  ──▶  Upstash "picks"
index.html  ──on load──▶  GET /api/catalog (all items) + GET /api/picks  ──▶  renders your selection
```

- `api/catalog.js` — fetches + parses the YouTube, Substack, and GitHub sources
  into JSON (`{videos, articles, repos}`), edge-cached. Each source is independent,
  so one failing returns `[]` for that section without breaking the rest. Powers
  both the checkboxes and the homepage.
- `api/picks.js` — `GET` returns the saved selection (public, always fresh);
  `POST` saves it (requires `X-Admin-Token`).
- The homepage's Videos/Writing lists are rendered client-side from your picks.
  If a column is left empty, it falls back to the latest items. If the API is
  unreachable, the statically-baked lists (from `update.py`) remain as a fallback.

Selection order follows the catalog (newest first). Changes are live on the
homepage as soon as you save and reload (the `/api/picks` read is uncached).

## Email alerts (optional)

The dashboard's **"Email alerts"** section lets you get an email when a visit
matches a rule — e.g. someone from a given **location** (country code, country,
or city) or via a given **referrer** (e.g. `linkedin`). Rules are stored in
Upstash and evaluated in `api/track.js` on every visit; each rule sends at most
one email per 15 minutes (throttled to avoid floods).

Sending needs a free [Resend](https://resend.com) account:

1. Sign up at Resend with the address you want alerts sent to.
2. Create an API key (Dashboard → API Keys).
3. In Vercel → project → Settings → Environment Variables, add
   `RESEND_API_KEY` = that key, then redeploy.

Until `RESEND_API_KEY` is set, rules still save but no emails send (the dashboard
shows this status). On Resend's free tier with no verified domain, mail is sent
from `onboarding@resend.dev` to your own account address — perfect for self-alerts.
To send from your own domain / to other addresses, verify a domain in Resend and
set an `ALERT_FROM` env var (e.g. `Portfolio <alerts@yourdomain.com>`).

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
