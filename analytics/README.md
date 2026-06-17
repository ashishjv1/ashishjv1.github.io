# Portfolio analytics

A tiny, free backend that counts **profile views** and **link clicks** for the
portfolio, plus a private dashboard at `/admin.html`.

Why a backend at all? GitHub Pages is static — it can't store numbers. This adds
a small [Cloudflare Worker](https://workers.dev) (free tier) with a KV store to
hold the counts. The site sends anonymous beacons to it; the dashboard reads them
back behind a password.

```
index.html  ──beacon──▶  Worker /track  ──▶  KV counters
admin.html  ──token───▶  Worker /stats  ◀──  KV counters
```

## One-time setup (~15 min)

You need a free Cloudflare account. Run these from this `analytics/` folder.

1. **Install Wrangler and log in**
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. **Create the KV namespace**
   ```bash
   wrangler kv namespace create STATS
   ```
   Copy the `id` it prints into `wrangler.toml` (replace `REPLACE_WITH_KV_NAMESPACE_ID`).

3. **Set the dashboard password** (any strong string you choose)
   ```bash
   wrangler secret put ADMIN_TOKEN
   ```

4. **Deploy**
   ```bash
   wrangler deploy
   ```
   Wrangler prints your Worker URL, e.g.
   `https://portfolio-analytics.yourname.workers.dev`.

5. **Plug the URL into the site.** Replace `YOUR-SUBDOMAIN` (two places):
   - `index.html` → the `ENDPOINT` constant in the analytics `<script>`
   - `admin.html` → `window.ANALYTICS_ENDPOINT`

   Also confirm the `ALLOWED_ORIGINS` list at the top of `worker.js` matches your
   live site URL, then commit and push. Until the URL is filled in, tracking is
   completely inert.

## Using it

- View the dashboard at `https://ashishjv1.github.io/admin.html`, enter your
  `ADMIN_TOKEN`, and you'll see total views and a ranked list of link clicks.
- The token is held only in that browser tab's session (`sessionStorage`).

## Notes & limits

- **Privacy:** no cookies, no personal data — just integer counters per label.
- **Click labels** come from each link's visible text. To set a custom label,
  add `data-track="whatever"` to the `<a>` in `index.html`.
- **Free-tier KV:** ~100k reads/day and ~1,000 writes/day. Each view or click is
  one write, so this comfortably covers a personal site.
- **Accuracy:** counters use read-then-write, so under heavy simultaneous traffic
  an occasional increment can be lost. Fine for a portfolio; if you ever need
  exact counts, switch the Worker to a Durable Object counter.
- `admin.html` is `noindex` and password-gated, but the file itself is public
  (anyone can open the login). The data behind it is protected by the token.
