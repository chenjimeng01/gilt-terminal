// Refresh script for Gilt Terminal.
//
// Fetches the UK Debt Management Office "Daily Reference Prices" CSV,
// extracts clean prices for each gilt the terminal tracks, and writes
// public/gilt-prices.json keyed by the terminal's `sym` identifier.
//
// Run by .github/workflows/refresh-gilt-prices.yml at 18:00 UTC Mon-Fri.
// Pure Node 20 (uses built-in fetch) so no `npm install` step is needed.
//
// If the DMO URL or column layout changes, see notes at the bottom for
// the next-best free sources (Yahoo Finance, BoE curve, Tradeweb PDFs).

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Config ────────────────────────────────────────────────────────────────
const DMO_URL =
  "https://www.dmo.gov.uk/data/ExportData/?reportCode=D1A&exportFormat=csv";

// Output path, relative to repo root.
const OUT_PATH = "public/gilt-prices.json";

// Gilts the terminal tracks. Match key is (coupon, maturity).
// Keep this list in sync with MASTER in GiltTerminal.jsx.
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

// ── CSV utilities ─────────────────────────────────────────────────────────

// Minimal RFC-4180-ish parser. Handles quoted fields with embedded commas
// and escaped double quotes. Adequate for DMO-style files.
function parseCsv(text) {
  // Strip BOM and normalise newlines.
  text = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const rows = [];
  let row = [];
  let cell = "";
  let i = 0;
  let inQuotes = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ",") { row.push(cell); cell = ""; i++; continue; }
    if (ch === "\n") {
      row.push(cell); rows.push(row); row = []; cell = ""; i++; continue;
    }
    cell += ch; i++;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ""));
}

// Header detection: find the first row that contains a redemption-date-ish
// header AND a price-ish header. DMO sometimes prefixes the file with a
// title row, so skipping until we find a real header is safer than
// assuming row 0.
const DATE_HDRS  = ["redemption date", "redemption", "redemption_date", "maturity"];
const PRICE_HDRS = ["clean price", "clean_price", "close of business clean price", "close clean price", "price (clean)"];
const COUPON_HDRS = ["coupon", "coupon (%)", "coupon%", "coupon rate"];
const NAME_HDRS  = ["gilt name", "stock description", "instrument", "name", "gilt"];

function lc(s) { return String(s ?? "").trim().toLowerCase(); }

function findHeaderRowIdx(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const lower = rows[i].map(lc);
    const hasDate  = DATE_HDRS.some(h => lower.includes(h));
    const hasPrice = PRICE_HDRS.some(h => lower.includes(h));
    if (hasDate && hasPrice) return i;
  }
  return -1;
}

function pickColumn(headerRow, candidates) {
  const lower = headerRow.map(lc);
  for (const c of candidates) {
    const idx = lower.indexOf(c);
    if (idx !== -1) return idx;
  }
  // fuzzy fallback: first header that contains a candidate word
  for (let i = 0; i < lower.length; i++) {
    if (candidates.some(c => lower[i].includes(c))) return i;
  }
  return -1;
}

// Parse a coupon string like "4 1/4", "4.25", "4 1/4%", "4 ⅛%" to a number.
function parseCoupon(s) {
  if (s == null) return NaN;
  let t = String(s).trim().replace("%", "").trim();
  // Replace common Unicode vulgar fractions.
  const FR = { "⅛": "1/8", "¼": "1/4", "⅜": "3/8", "½": "1/2", "⅝": "5/8", "¾": "3/4", "⅞": "7/8" };
  for (const [k, v] of Object.entries(FR)) t = t.replace(k, " " + v);
  t = t.replace(/\s+/g, " ").trim();
  const m = t.match(/^(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?$/);
  if (m) {
    const whole = parseFloat(m[1]);
    const frac  = m[2] ? parseInt(m[2], 10) / parseInt(m[3], 10) : 0;
    return whole + frac;
  }
  // Last resort: parseFloat ignores trailing junk.
  const f = parseFloat(t);
  return Number.isFinite(f) ? f : NaN;
}

// Parse "31/07/2034", "31-Jul-2034", "2034-07-31", etc. → "YYYY-MM-DD".
function parseDate(s) {
  if (!s) return null;
  const t = String(s).trim();
  let m;

  // ISO already
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  // DD/MM/YYYY or D/M/YYYY
  m = t.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (m) return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`;

  // DD-MMM-YYYY or D-MMM-YYYY
  m = t.match(/^(\d{1,2})[- ]([A-Za-z]{3,9})[- ](\d{4})$/);
  if (m) {
    const mo = monthIdx(m[2]);
    if (mo !== -1) return `${m[3]}-${pad2(mo + 1)}-${pad2(m[1])}`;
  }
  return null;
}
function pad2(n) { return String(n).padStart(2, "0"); }
function monthIdx(s) {
  const months = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];
  return months.indexOf(s.slice(0, 3).toLowerCase());
}

function parseNumber(s) {
  if (s == null) return NaN;
  const t = String(s).replace(/,/g, "").replace(/£/g, "").trim();
  const f = parseFloat(t);
  return Number.isFinite(f) ? f : NaN;
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Fetching: ${DMO_URL}`);
  const res = await fetch(DMO_URL, {
    headers: { "User-Agent": "gilt-terminal-refresh/1.0 (+github actions)" },
  });
  if (!res.ok) throw new Error(`DMO fetch failed: HTTP ${res.status}`);
  const csv = await res.text();
  if (csv.length < 200) throw new Error(`DMO response suspiciously small (${csv.length} bytes)`);

  const rows = parseCsv(csv);
  const hdrIdx = findHeaderRowIdx(rows);
  if (hdrIdx === -1) {
    console.error("First 10 rows of response:");
    console.error(rows.slice(0, 10));
    throw new Error("Could not locate a header row containing both a redemption-date and a clean-price column. The DMO export format may have changed.");
  }
  const header = rows[hdrIdx];
  const dataRows = rows.slice(hdrIdx + 1);

  const colDate   = pickColumn(header, DATE_HDRS);
  const colPrice  = pickColumn(header, PRICE_HDRS);
  const colCoupon = pickColumn(header, COUPON_HDRS);
  const colName   = pickColumn(header, NAME_HDRS);
  console.log(`Header row idx=${hdrIdx}; cols → date:${colDate} price:${colPrice} coupon:${colCoupon} name:${colName}`);
  if (colDate === -1 || colPrice === -1) {
    throw new Error("Required columns not found in DMO header.");
  }

  // Build (coupon, mat) → sym lookup.
  const lookup = new Map();
  for (const g of GILTS) lookup.set(`${g.c.toFixed(4)}|${g.mat}`, g.sym);

  const prices = {};
  const matched = new Set();
  let scanned = 0;
  let datedRows = 0;

  for (const r of dataRows) {
    scanned++;
    const matIso = parseDate(r[colDate]);
    if (!matIso) continue;
    datedRows++;

    let coupon = colCoupon !== -1 ? parseCoupon(r[colCoupon]) : NaN;
    // Some DMO exports put coupon inside the name column instead.
    if ((!Number.isFinite(coupon)) && colName !== -1) {
      const nm = String(r[colName] ?? "");
      const m = nm.match(/(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?\s*%/);
      if (m) coupon = parseFloat(m[1]) + (m[2] ? parseInt(m[2], 10) / parseInt(m[3], 10) : 0);
    }
    if (!Number.isFinite(coupon)) continue;

    const key = `${coupon.toFixed(4)}|${matIso}`;
    const sym = lookup.get(key);
    if (!sym) continue;

    const px = parseNumber(r[colPrice]);
    if (!Number.isFinite(px) || px <= 0 || px > 250) continue;

    prices[sym] = +px.toFixed(4);
    matched.add(sym);
  }

  console.log(`Rows scanned: ${scanned}; rows with parseable dates: ${datedRows}; matched gilts: ${matched.size}/${GILTS.length}`);

  if (matched.size === 0) {
    throw new Error("No gilts matched. Aborting so the previous gilt-prices.json is preserved.");
  }
  const expected = GILTS.length;
  const ratio = matched.size / expected;
  if (ratio < 0.5) {
    // Soft check: still write the file but log loudly. Better to update some
    // than nothing.
    console.warn(`Only ${matched.size}/${expected} gilts matched (${(ratio * 100).toFixed(1)}%). Investigate.`);
  }

  const missing = GILTS.filter(g => !matched.has(g.sym)).map(g => g.sym);
  if (missing.length) console.warn(`Missing: ${missing.join(", ")}`);

  const today = new Date().toISOString().slice(0, 10);
  const out = {
    asOf: today,
    source: "UK DMO Daily Reference Prices (D1A)",
    sourceUrl: DMO_URL,
    fetched: new Date().toISOString(),
    count: matched.size,
    prices,
  };

  // Resolve OUT_PATH relative to repo root (script lives in scripts/).
  const here = dirname(fileURLToPath(import.meta.url));
  const outAbs = resolve(here, "..", OUT_PATH);
  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${outAbs} (${matched.size} prices, asOf ${today})`);
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});

// ── Notes for switching data source ───────────────────────────────────────
// If the DMO export breaks long-term, swap fetch + parser with one of:
//   1. Yahoo Finance (`query2.finance.yahoo.com/v7/finance/quote?symbols=TG46.L,...`)
//      — unofficial; symbols use `.L` suffix not `:LSE`; rate-limited but free.
//   2. Bank of England yield curve XLS — requires interpolation, not direct
//      clean prices. Lower fidelity for individual gilts.
//   3. Tradeweb FTSE Gilt Closing Prices PDFs — fragile parsing, only as
//      a last resort.
// In all cases the output JSON shape stays the same so the React side
// doesn't change.
