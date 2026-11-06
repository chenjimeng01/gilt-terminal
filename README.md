# Gilt Terminal

UK Treasury Gilts ranked by after-tax yield to maturity, refreshed daily from the
UK Debt Management Office's published reference prices.

## What's in this repo

```
.
├── .github/workflows/refresh-gilt-prices.yml   # Cron job: rebuilds + verifies prices each weekday at 18:00 UTC
├── public/gilt-prices.json                     # Daily-refreshed price file (committed by the workflow)
├── scripts/
│   ├── refresh-gilt-prices.js                  # DMO D10B .xls → gilt-prices.json (clean + dirty)
│   └── verify-gilt-prices.js                   # npm run verify: DMO dirty = clean + our accrued?
├── src/
│   ├── GiltTerminal.jsx                        # Analyser UI (after-tax YTM ranking)
│   ├── LadderView.jsx                          # Ladder builder UI
│   ├── giltMath.js                             # Shared maths: coupon schedule, accrued, ex-div, tax, YTM
│   ├── ladderEngine.js                         # Ladder selection, sizing, cash flows, IRR, cash benchmark
│   ├── giltUniverse.js                         # Tracked gilts (MASTER) with fallback prices
│   └── main.jsx                                # React mount
├── *.test.mjs, test-fixtures/                  # node --test suites + frozen 2026-11-04 prices
├── index.html
├── package.json
└── vite.config.js
```

## How it works

1. **Build-time / first deploy.** Vercel (or any static host) builds the Vite project
   and serves `public/gilt-prices.json` at `/gilt-prices.json`.
2. **Daily refresh.** GitHub Actions runs `scripts/refresh-gilt-prices.js` at 18:00 UTC
   Mon-Fri. The script fetches the DMO's "Daily Reference Prices" CSV, matches each
   row against the gilts the terminal tracks, and rewrites `public/gilt-prices.json` with
   clean prices (`prices`), DMO dirty prices (`dirty`) and their `settlement` date (T+1).
   `npm run verify` then checks every dirty price against clean + our accrued interest
   (±0.005); if it fails, nothing is committed.
3. **Auto-redeploy.** When the workflow commits a changed JSON file, the host
   (Vercel / Netlify / Pages) detects the push and redeploys.
4. **Client.** On each page load `GiltTerminal.jsx` does one `fetch('/gilt-prices.json')`,
   prices every gilt for T+1 settlement after the file's `asOf` (using the DMO dirty
   price when it is for that date), and shows a stale-data warning if the file is more
   than 4 days old.

## Local development

```bash
npm install
npm run dev          # http://localhost:5173
```

To regenerate `public/gilt-prices.json` from the live DMO file, then check it:

```bash
npm run refresh
```

```bash
npm run verify
```

Tests (run under both `TZ=UTC` and `TZ=Europe/London`):

```bash
npm test
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

- **Dates** are UTC throughout. Coupon dates are maturity − 6k months, clamped to month
  end (31 Aug → 28/29 Feb → 31 Aug).
- **Settlement** is the next business day after the price date (weekends only; UK bank
  holidays are not modelled).
- **Accrued interest** is Actual/Actual from the coupon schedule. Within 7 business days
  of a coupon the gilt trades ex-dividend: the buyer forgoes that coupon and accrued
  interest is negative. Where the DMO dirty price is available for the settlement date,
  it is used directly.
- **Yield to maturity** follows the DMO formula: cash flows are discounted in coupon
  periods (days to next coupon ÷ days in the period, then whole half-years) with
  semi-annual compounding, solved by bisection on [−50%, 100%] to 1e-10. If no yield in
  that range reprices the gilt, it shows "—" with a warning, never a boundary value.
- **Tax.** Coupons are taxed at the chosen rate; redemption gains are CGT-exempt (TCGA
  1992 s.115). Accrued income scheme: a cum-div buyer is taxed on the first coupon only
  net of the accrued interest paid; an ex-div buyer is taxed on the rebate interest
  (HMRC SAIM4150). The analyser and the ladder share this model.
- **Ladder IRR** is annual effective (actual/365.25) so it compares directly with the
  cash rate; analyser yields are semi-annual. Annual = (1 + y/2)² − 1.
- **Ladder vs cash** values every after-tax coupon and redemption the ladder pays at the
  cash rate and subtracts its cost. It is positive exactly when the ladder's IRR beats
  the cash rate.
- **Your live prices (✎).** Any gilt's price can be overridden from the analyser or the
  ladder table, as clean or dirty. It is treated as today's dealing price, so it settles
  T+1 from today (accrued interest and ex-dividend status at that date); the DMO file's
  dirty price is ignored for that gilt. The ladder applies the clean price at its own
  settlement date. Overrides are one-off: page memory only — not saved, not in share
  links, cleared on reload.
- **Ladder options:** inflation-linked liabilities (amounts in today's money), and
  coupon-offset sizing (coupons received before each liability, held in cash at the
  cash rate, pay part of it, so less nominal is bought). Each rung shows how long its
  redemption sits in cash before the liability and what that earns.

Not financial advice. Verify prices before dealing.
