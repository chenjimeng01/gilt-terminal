// Refresh script for Gilt Terminal.
//
// Fetches the latest LSE close price for each tracked gilt via Yahoo
// Finance's public chart endpoint and writes public/gilt-prices.json.
// Each UK gilt's LSE EPIC code maps to <code>.L on Yahoo.
//
// Run by .github/workflows/refresh-gilt-prices.yml at 18:00 UTC Mon-Fri.
// Pure Node 20 (uses built-in fetch) so no `npm install` step is needed.
//
// If Yahoo blocks unauthenticated traffic, see notes at the bottom for
// alternative free sources.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Config ────────────────────────────────────────────────────────────────

const YAHOO_CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const UA =
  "Mozilla/5.0 (compatible; gilt-terminal-refresh/1.0; +https://github.com/chenjimeng01/gilt-terminal)";

// Output path, relative to repo root.
const OUT_PATH = "public/gilt-prices.json";

// Polite delay between Yahoo requests (ms).
const REQUEST_DELAY_MS = 80;

// Per-request timeout.
const FETCH_TIMEOUT_MS = 8000;

// Skip writing if we matched fewer than this many gilts (preserve previous good file).
const MIN_MATCHES = 30;

// Gilts the terminal tracks. `sym` is the LSE EPIC code; on Yahoo Finance
// the ticker is `<sym>.L`.
const GILTS = [
  { sym: "TN34", c: 4.25,  mat: "2034-07-31" },
  { sym: "TG40", c: 4.375, mat: "2040-01-31" },
  { sym: "TG47", c: 1.5,   mat: "2047-07-22" },
  { sym: "TG46", c: 0.875, mat: "2046-01-31" },
  { sym: "TG44", c: 3.25,  mat: "2044-01-22" },
  { sym: "TG41", c: 1.25,  mat: "2041-10-22" },
  { sym: "TG49", c: 1.75,  mat: "2049-01-22" },
  { sym: "TS29", c: 4.125, mat: "2029-07-22" },
  { sym: "TS28", c: 4.5,   mat: "2028-06-07" },
  { sym: "TS27", c: 3.75,  mat: "2027-03-07" },
  { sym: "TG37", c: 1.75,  mat: "2037-09-07" },
  { sym: "TG35", c: 0.625, mat: "2035-07-31" },
  { sym: "T33H", c: 4.125, mat: "2033-03-07" },
  { sym: "TG33", c: 0.875, mat: "2033-07-31" },
  { sym: "TG32", c: 1.0,   mat: "2032-01-31" },
  { sym: "TG31", c: 0.25,  mat: "2031-07-31" },
  { sym: "T29K", c: 4.0,   mat: "2029-05-22" },
  { sym: "TG30", c: 0.375, mat: "2030-10-22" },
  { sym: "TG38", c: 3.75,  mat: "2038-01-29" },
  { sym: "TR39", c: 1.125, mat: "2039-01-31" },
  { sym: "TR38", c: 4.75,  mat: "2038-12-07" },
  { sym: "T35V", c: 4.75,  mat: "2035-10-22" },
  { sym: "TG61", c: 0.5,   mat: "2061-10-22" },
  { sym: "TE28", c: 4.375, mat: "2028-03-07" },
  { sym: "TG65", c: 2.5,   mat: "2065-07-22" },
  { sym: "TR43", c: 4.75,  mat: "2043-10-22" },
  { sym: "TR29", c: 0.875, mat: "2029-10-22" },
  { sym: "TR28", c: 6.0,   mat: "2028-12-07" },
  { sym: "TR27", c: 4.25,  mat: "2027-12-07" },
  { sym: "TN28", c: 0.125, mat: "2028-01-31" },
  { sym: "TG50", c: 0.625, mat: "2050-10-22" },
  { sym: "TG57", c: 1.75,  mat: "2057-07-22" },
  { sym: "TG53", c: 1.5,   mat: "2053-07-31" },
  { sym: "T51A", c: 1.25,  mat: "2051-07-31" },
  { sym: "TR34", c: 4.5,   mat: "2034-09-07" },
  { sym: "TR33", c: 3.25,  mat: "2033-01-31" },
  { sym: "TR32", c: 4.25,  mat: "2032-06-07" },
  { sym: "TR30", c: 4.75,  mat: "2030-12-07" },
  { sym: "T26A", c: 0.375, mat: "2026-10-22" },
  { sym: "TR63", c: 4.0,   mat: "2063-10-22" },
  { sym: "TR60", c: 4.0,   mat: "2060-01-22" },
  { sym: "TG71", c: 1.625, mat: "2071-10-22" },
  { sym: "T30",  c: 4.375, mat: "2030-03-07" },
  { sym: "T31",  c: 4.0,   mat: "2031-10-22" },
  { sym: "T41F", c: 5.25,  mat: "2041-01-31" },
  { sym: "T34",  c: 4.625, mat: "2034-01-31" },
  { sym: "T37H", c: 4.625, mat: "2037-03-07" },
  { sym: "T35",  c: 4.5,   mat: "2035-03-07" },
  { sym: "TR54", c: 1.625, mat: "2054-10-22" },
  { sym: "T39",  c: 4.25,  mat: "2039-09-07" },
  { sym: "TR4Q", c: 4.25,  mat: "2055-12-07" },
  { sym: "TG26", c: 1.5,   mat: "2026-07-22" },
  { sym: "T40",  c: 4.25,  mat: "2040-12-07" },
  { sym: "T42",  c: 4.5,   mat: "2042-12-07" },
  { sym: "T45",  c: 3.5,   mat: "2045-01-22" },
  { sym: "T46",  c: 4.25,  mat: "2046-12-07" },
  { sym: "T49",  c: 4.25,  mat: "2049-12-07" },
  { sym: "TG29", c: 0.5,   mat: "2029-01-31" },
  { sym: "TG28", c: 1.625, mat: "2028-10-22" },
  { sym: "TG27", c: 1.25,  mat: "2027-07-22" },
  { sym: "TR68", c: 3.5,   mat: "2068-07-22" },
  { sym: "T27A", c: 4.125, mat: "2027-01-29" },
  { sym: "T4Q",  c: 4.25,  mat: "2036-03-07" },
  { sym: "T52",  c: 3.75,  mat: "2052-07-22" },
  { sym: "T31H", c: 4.125, mat: "2031-03-07" },
  { sym: "T54",  c: 4.375, mat: "2054-07-31" },
  { sym: "T53",  c: 3.75,  mat: "2053-10-22" },
  { sym: "T56",  c: 5.375, mat: "2056-01-31" },
  { sym: "TR73", c: 1.125, mat: "2073-10-22" },
];

// ── Helpers ───────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Yahoo quotes UK gilts in pence (GBp) per £100 nominal — e.g. 9251 means
// £92.51. Sometimes the meta block reports values already in GBP. We
// detect by magnitude: any price > 250 is assumed pence and divided by 100.
function normalisePrice(px) {
  if (!Number.isFinite(px)) return NaN;
  if (px > 250) return +(px / 100).toFixed(4);
  if (px <= 0) return NaN;
  return +px.toFixed(4);
}

async function fetchYahoo(sym) {
  const url = `${YAHOO_CHART}/${sym}.L?interval=1d&range=5d`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/json" },
      signal: ctl.signal,
    });
    if (!res.ok) return { sym, error: `HTTP ${res.status}` };
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) {
      const errDesc = json?.chart?.error?.description || "no result";
      return { sym, error: errDesc };
    }
    const meta = result.meta || {};
    const closes = result.indicators?.quote?.[0]?.close || [];
    const lastClose = [...closes].reverse().find(v => v != null);
    const raw = meta.regularMarketPrice ?? lastClose;
    const px = normalisePrice(raw);
    if (!Number.isFinite(px)) return { sym, error: `bad price (raw ${raw})` };
    return { sym, price: px, currency: meta.currency || null };
  } catch (e) {
    return { sym, error: e.name === "AbortError" ? "timeout" : (e.message || String(e)) };
  } finally {
    clearTimeout(t);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Fetching ${GILTS.length} gilts from Yahoo Finance (LSE)…`);
  const prices = {};
  const errors = [];

  for (let i = 0; i < GILTS.length; i++) {
    const g = GILTS[i];
    const r = await fetchYahoo(g.sym);
    if (r.error) {
      errors.push(`${g.sym}: ${r.error}`);
    } else {
      prices[r.sym] = r.price;
    }
    if (i < GILTS.length - 1) await sleep(REQUEST_DELAY_MS);
  }

  const matched = Object.keys(prices).length;
  console.log(`Matched ${matched}/${GILTS.length} gilts.`);
  if (errors.length) {
    console.warn(`${errors.length} errors (showing first 15):`);
    for (const e of errors.slice(0, 15)) console.warn(`  ${e}`);
  }

  if (matched < MIN_MATCHES) {
    throw new Error(
      `Only ${matched} gilts matched (need at least ${MIN_MATCHES}). ` +
      `Aborting so the previous gilt-prices.json is preserved.`
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const out = {
    asOf: today,
    source: "Yahoo Finance (LSE close)",
    sourceUrl: "https://finance.yahoo.com",
    fetched: new Date().toISOString(),
    count: matched,
    prices,
  };

  // Resolve OUT_PATH relative to repo root (script lives in scripts/).
  const here = dirname(fileURLToPath(import.meta.url));
  const outAbs = resolve(here, "..", OUT_PATH);
  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${outAbs} (${matched} prices, asOf ${today})`);
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});

// ── Notes for switching data source ───────────────────────────────────────
// If Yahoo starts requiring auth (cookie + crumb) or blocks the runner:
//   1. UK DMO Daily Reference Prices — a CSV/Excel export linked from
//      https://www.dmo.gov.uk/data/. The download URL is not stable and
//      is generated by JS on the page; inspect via DevTools Network tab.
//   2. Bank of England yield curve XLS — requires interpolation, not
//      direct clean prices. Lower fidelity for individual gilts.
//   3. Tradeweb FTSE Gilt Closing Prices PDFs — fragile parsing; last
//      resort.
// In all cases the output JSON shape stays the same so the React side
// doesn't change.
