// Refresh script for Gilt Terminal.
//
// Fetches the UK DMO Gilt Purchase and Sale Service Daily Reference Prices
// (report code D10B) and writes public/gilt-prices.json. Each entry records
// the DMO clean (mid) reference price for that gilt on the trade date.
//
// Run by .github/workflows/refresh-gilt-prices.yml at 18:00 UTC Mon-Fri.
// Requires the `xlsx` package (BIFF8 .xls parser); installed via npm in the
// workflow before this script runs.
//
// Source: https://www.dmo.gov.uk/data/  →  Daily Reference Prices (D10B).

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

// ── Config ────────────────────────────────────────────────────────────────

const DMO_BASE =
  "https://www.dmo.gov.uk/umbraco/surface/DataExport/GetDataExport";
const DMO_REPORT_CODE = "D10B";
const UA =
  "Mozilla/5.0 (compatible; gilt-terminal-refresh/1.0; +https://github.com/chenjimeng01/gilt-terminal)";

// Output path, relative to repo root.
const OUT_PATH = "public/gilt-prices.json";

// Per-request timeout.
const FETCH_TIMEOUT_MS = 15000;

// Skip writing if we matched fewer than this many gilts (preserve previous good file).
const MIN_MATCHES = 60;

// How many UK business days to walk back if today's file is incomplete.
const MAX_LOOKBACK_DAYS = 7;

// A valid full DMO daily file is roughly 46 KB; bank holidays / weekends
// produce a stub around 16 KB. We treat anything under this threshold as
// "no data" and walk back another day.
const MIN_FILE_BYTES = 30000;

// Gilts the terminal tracks. `sym` is the LSE EPIC code; `c` is the coupon
// (% per year) and `mat` is the maturity date (YYYY-MM-DD). We match each
// gilt by (coupon, maturity-year) against the DMO gilt-name string.
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

function pad2(n) { return String(n).padStart(2, "0"); }

function fmtDmoDate(d) {
  return `${pad2(d.getUTCDate())}/${pad2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
}

function fmtIsoDate(d) {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function buildDmoUrl(d) {
  const dmy = encodeURIComponent(fmtDmoDate(d));
  // Note: the DMO endpoint requires a leading "&" inside the parameters
  // value (encoded as %26) — this is how its createParameterString helper
  // serialises form fields. Without it the report comes back empty.
  const params =
    `?reportCode=${DMO_REPORT_CODE}` +
    `&exportFormatValue=xls` +
    `&parameters=${encodeURIComponent("&Trade Date=")}${dmy}`;
  return DMO_BASE + params;
}

// Unicode fraction → decimal mapping (used in legacy gilt names like "1½%").
const UNICODE_FRACTIONS = {
  "\u00BC": 0.25,   // ¼
  "\u00BD": 0.5,    // ½
  "\u00BE": 0.75,   // ¾
  "\u2153": 1 / 3,  // ⅓
  "\u2154": 2 / 3,  // ⅔
  "\u215B": 0.125,  // ⅛
  "\u215C": 0.375,  // ⅜
  "\u215D": 0.625,  // ⅝
  "\u215E": 0.875,  // ⅞
};

// Parse coupon out of a DMO gilt-name string like
//   "4 1/8% Treasury Gilt 2033"   → 4.125
//   "5% Treasury Stock 2036"      → 5
//   "1½% Treasury Gilt 2026"      → 1.5
// Returns null if not a recognisable conventional-gilt name.
function parseGiltName(name) {
  if (typeof name !== "string") return null;
  const s = name.trim();
  // Reject index-linked ("Index-linked") and rumps quickly.
  if (/index[-\s]?linked/i.test(s)) return null;
  // Year (last 4-digit token).
  const yearMatch = s.match(/(\d{4})\s*$/);
  if (!yearMatch) return null;
  const year = parseInt(yearMatch[1], 10);
  // Coupon must precede "%". Accept either ASCII fractions ("4 1/8%") or
  // Unicode fractions ("1½%", "0⅝%").
  // Strip everything after the first "%".
  const pctIdx = s.indexOf("%");
  if (pctIdx <= 0) return null;
  let head = s.slice(0, pctIdx).trim();
  let coupon = NaN;

  // Try Unicode fraction at the end of head (e.g. "1½", "⅝", "0⅝")
  const lastChar = head[head.length - 1];
  if (UNICODE_FRACTIONS[lastChar] != null) {
    const intPart = head.slice(0, -1).trim();
    const intVal = intPart === "" ? 0 : parseFloat(intPart);
    if (Number.isFinite(intVal)) coupon = intVal + UNICODE_FRACTIONS[lastChar];
  } else {
    // ASCII fraction: "4 1/8" or "0 7/8"
    const asciiFrac = head.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (asciiFrac) {
      const i = parseFloat(asciiFrac[1]);
      const n = parseFloat(asciiFrac[2]);
      const d = parseFloat(asciiFrac[3]);
      if (d > 0) coupon = i + n / d;
    } else if (/^\d+(\.\d+)?$/.test(head)) {
      coupon = parseFloat(head);
    }
  }

  if (!Number.isFinite(coupon)) return null;
  return { coupon, year, name: s };
}

function couponMatches(a, b) {
  return Math.abs(a - b) < 0.005;
}

async function fetchDmoXls(d) {
  const url = buildDmoUrl(d);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, "Accept": "application/octet-stream,*/*" },
      signal: ctl.signal,
    });
    if (!res.ok) return { url, error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    return { url, buf };
  } catch (e) {
    return { url, error: e.name === "AbortError" ? "timeout" : (e.message || String(e)) };
  } finally {
    clearTimeout(t);
  }
}

// Walk through all sheets/rows and return [{ name, isin, clean, dirty }].
function extractGiltRows(buf) {
  const wb = XLSX.read(buf, { type: "buffer" });
  const out = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      // Find the gilt-name column (first cell that looks like a name)
      // and the ISIN column (cell starting with "GB00") — be tolerant of
      // varying column orders.
      let name = null;
      let isin = null;
      let nums = [];
      for (const cell of row) {
        if (cell == null) continue;
        if (typeof cell === "string") {
          const trimmed = cell.trim();
          if (/^GB00[A-Z0-9]{8}$/i.test(trimmed)) {
            isin = trimmed.toUpperCase();
          } else if (trimmed.includes("%") && /\d{4}\s*$/.test(trimmed) && name == null) {
            name = trimmed;
          } else if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
            nums.push(parseFloat(trimmed));
          }
        } else if (typeof cell === "number" && Number.isFinite(cell)) {
          nums.push(cell);
        }
      }
      if (!name || nums.length < 1) continue;
      // The DMO format is [Name, CleanPrice, DirtyPrice, ISIN]. Use the
      // smallest of the numbers as the clean price (dirty = clean + accrued
      // ≥ clean; both well below 250 so no scale issue).
      nums.sort((a, b) => a - b);
      const clean = nums[0];
      const dirty = nums[1] != null ? nums[1] : null;
      out.push({ name, isin, clean, dirty });
    }
  }
  return out;
}

function matchGilts(rows) {
  const prices = {};
  const errors = [];
  for (const g of GILTS) {
    const matYear = parseInt(g.mat.slice(0, 4), 10);
    const candidates = rows
      .map(r => ({ row: r, parsed: parseGiltName(r.name) }))
      .filter(x => x.parsed && x.parsed.year === matYear && couponMatches(x.parsed.coupon, g.c));
    if (candidates.length === 0) {
      errors.push(`${g.sym} (${g.c}% ${matYear}): no matching DMO row`);
      continue;
    }
    if (candidates.length > 1) {
      // Multiple gilts with same coupon + year: use the one whose clean
      // price is finite. (Shouldn't normally happen for conventional gilts.)
      errors.push(`${g.sym}: ${candidates.length} ambiguous matches, taking first`);
    }
    const chosen = candidates[0].row;
    if (!Number.isFinite(chosen.clean)) {
      errors.push(`${g.sym}: matched but clean price not numeric`);
      continue;
    }
    prices[g.sym] = +chosen.clean.toFixed(4);
  }
  return { prices, errors };
}

// ── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const today = new Date();
  let chosenDate = null;
  let chosenRows = null;
  let chosenSize = 0;
  let chosenUrl = null;

  for (let lookback = 0; lookback < MAX_LOOKBACK_DAYS; lookback++) {
    const d = new Date(Date.UTC(
      today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - lookback
    ));
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) continue; // skip Sat/Sun

    const url = buildDmoUrl(d);
    console.log(`Trying DMO D10B for ${fmtIsoDate(d)} → ${url}`);
    const { buf, error } = await fetchDmoXls(d);
    if (error) {
      console.warn(`  fetch failed: ${error}`);
      continue;
    }
    if (buf.length < MIN_FILE_BYTES) {
      console.warn(`  small file (${buf.length} bytes) — likely a holiday stub, skipping`);
      continue;
    }
    let rows;
    try {
      rows = extractGiltRows(buf);
    } catch (e) {
      console.warn(`  parse failed: ${e.message}`);
      continue;
    }
    console.log(`  parsed ${rows.length} rows from ${buf.length}-byte file`);
    if (rows.length < MIN_MATCHES) {
      console.warn(`  too few rows (${rows.length}), skipping`);
      continue;
    }
    chosenDate = d;
    chosenRows = rows;
    chosenSize = buf.length;
    chosenUrl = url;
    break;
  }

  if (!chosenRows) {
    throw new Error(
      `Could not fetch a usable DMO D10B file in the last ${MAX_LOOKBACK_DAYS} days. ` +
      `Aborting so the previous gilt-prices.json is preserved.`
    );
  }

  const { prices, errors } = matchGilts(chosenRows);
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

  const out = {
    asOf: fmtIsoDate(chosenDate),
    source: "UK DMO Daily Reference Prices (D10B, clean mid)",
    sourceUrl: chosenUrl,
    fetched: new Date().toISOString(),
    count: matched,
    prices,
  };

  // Resolve OUT_PATH relative to repo root (script lives in scripts/).
  const here = dirname(fileURLToPath(import.meta.url));
  const outAbs = resolve(here, "..", OUT_PATH);
  mkdirSync(dirname(outAbs), { recursive: true });
  writeFileSync(outAbs, JSON.stringify(out, null, 2) + "\n");
  console.log(`Wrote ${outAbs} (${matched} prices, asOf ${out.asOf}, ${chosenSize} bytes upstream)`);
}

main().catch(err => {
  console.error(err.stack || err.message || err);
  process.exit(1);
});
