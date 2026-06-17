# Portfolio analytics

Counts **profile views** and **link clicks**, with a private dashboard at
`/admin.html`. The site stays on GitHub Pages; the data backend runs on **Vercel**
(serverless functions) with **Upstash Redis** for storage.

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

2. **Add Upstash Redis.** In the project → *Storage* → *Marketplace* →
   **Upstash Redis** → create a free database and connect it. This auto-adds the
   `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` env vars that
   `Redis.fromEnv()` reads.

3. **Set the dashboard password.** Project → *Settings → Environment Variables* →
   add `ADMIN_TOKEN` = any strong string you choose. Redeploy so it takes effect.

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

## Notes & limits

- **Privacy:** no cookies, no personal data — just integer counters per label.
- **Click labels** come from each link's visible text. For a custom label, add
  `data-track="whatever"` to the `<a>` in `index.html`.
- **Free tiers:** Vercel Hobby + Upstash free database comfortably cover a
  personal site.
- `admin.html` is `noindex` and password-gated, but the file itself is public
  (anyone can open the login). The data behind it is protected by the token.
