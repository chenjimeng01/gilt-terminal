# Gilt Terminal

UK Treasury Gilts ranked by after-tax yield to maturity, refreshed daily from the
UK Debt Management Office's published reference prices.

## What's in this repo

```
.
├── .github/workflows/refresh-gilt-prices.yml   # Cron job: rebuilds prices each weekday at 18:00 UTC
├── public/gilt-prices.json                     # Daily-refreshed price file (committed by the workflow)
├── scripts/refresh-gilt-prices.js              # Pure-Node parser: DMO CSV → gilt-prices.json
├── src/
│   ├── GiltTerminal.jsx                        # The terminal UI
│   └── main.jsx                                # React mount
├── index.html
├── package.json
└── vite.config.js
```

## How it works

1. **Build-time / first deploy.** Vercel (or any static host) builds the Vite project
   and serves `public/gilt-prices.json` at `/gilt-prices.json`.
2. **Daily refresh.** GitHub Actions runs `scripts/refresh-gilt-prices.js` at 18:00 UTC
   Mon-Fri. The script fetches the DMO's "Daily Reference Prices" CSV, matches each
   row against the gilts the terminal tracks, and rewrites `public/gilt-prices.json`.
3. **Auto-redeploy.** When the workflow commits a changed JSON file, the host
   (Vercel / Netlify / Pages) detects the push and redeploys.
4. **Client.** On each page load `GiltTerminal.jsx` does one `fetch('/gilt-prices.json')`,
   uses those clean prices to recompute after-tax YTM, and shows a stale-data warning
   if the file is more than 4 days old.

## Local development

```bash
npm install
npm run dev          # http://localhost:5173
```

To regenerate `public/gilt-prices.json` from the live DMO file:

```bash
npm run refresh
```

## Deploying to Vercel

1. Push this repo to GitHub.
2. Go to <https://vercel.com>, sign in with GitHub, click **Add New → Project**.
3. Import this repo. Vercel auto-detects Vite — accept all defaults and click **Deploy**.
4. After the first build finishes you'll have a URL like `https://gilt-terminal-xxx.vercel.app`.

## Verifying the daily refresh

- After the first 18:00-UTC weekday tick, the GitHub **Actions** tab should show a
  green run of "Refresh gilt prices".
- If the JSON content actually changed, a commit appears on `main` and Vercel
  redeploys automatically.
- If the workflow ever fails (e.g. DMO format change), the previous good
  `gilt-prices.json` is preserved and the terminal continues to load with the
  last known prices.

## Replacing the data source

If the DMO export breaks long-term, swap the body of `scripts/refresh-gilt-prices.js`
for one of the alternatives noted at the bottom of that file (Yahoo Finance, BoE
yield curve, Tradeweb PDFs). The output JSON shape stays the same, so the React
side never has to change.

## Notes

- **0% CGT** on gilt redemption gains is built into the math; only coupons are taxed.
- Accrued interest is computed locally with a 182.5-day half-coupon assumption.
  This is a small approximation vs. the DMO's Actual/Actual; acceptable for ranking.
- YTM is solved by bisection over 80 iterations, semi-annual compounding, with
  `n = round(years × 2)` periods. Off by up to half a period near coupon dates.

Not financial advice. Verify prices before dealing.
