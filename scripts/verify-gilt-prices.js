// Data check for public/gilt-prices.json (npm run verify).
//
// The DMO publishes both clean and dirty reference prices for next-business-
// day settlement. For every gilt with a dirty price, recompute
//   clean + accrued interest at `settlement`   (giltMath.settlementTerms,
//                                               ex-dividend aware)
// and fail if it differs from the DMO dirty price by more than TOLERANCE.
// This is the check that would have caught the Jan–Jun accrued-interest bug.
//
// Usage: node scripts/verify-gilt-prices.js [path] [--require-dirty]
//   --require-dirty  fail if the file has no dirty prices (used by the refresh
//                    workflow; files written before 2026-11 have none).

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { settlementTerms, priceSettlement } from "../src/giltMath.js";
import { MASTER } from "../src/giltUniverse.js";

export const TOLERANCE = 0.005;

/**
 * Returns { settlement, checked, failures: [{sym, clean, dirty, ai, expected, diff}],
 *           missing: [sym], skipped?: string }.
 */
export function verifyPrices(json) {
  const dirty = json.dirty && typeof json.dirty === "object" ? json.dirty : null;
  const settlementStr = json.settlement ?? (json.asOf ? priceSettlement(json.asOf).toISOString().slice(0, 10) : null);
  const out = { settlement: settlementStr, checked: 0, failures: [], missing: [] };
  if (!dirty || !Object.keys(dirty).length) {
    out.skipped = "no dirty prices in file (written before the refresh script recorded them)";
    return out;
  }
  if (!settlementStr) {
    out.skipped = "no settlement or asOf date in file";
    return out;
  }
  const settlement = new Date(settlementStr + "T00:00:00Z");
  const bySym = new Map(MASTER.map(g => [g.sym, g]));

  for (const [sym, clean] of Object.entries(json.prices || {})) {
    const g = bySym.get(sym);
    const d = dirty[sym];
    if (!g || typeof d !== "number") { out.missing.push(sym); continue; }
    const terms = settlementTerms(g.c, g.mat, settlement);
    if (!terms) { out.missing.push(sym); continue; }
    const expected = clean + terms.ai;
    const diff = d - expected;
    out.checked++;
    if (Math.abs(diff) > TOLERANCE) {
      out.failures.push({ sym, clean, dirty: d, ai: terms.ai, expected, diff, exDiv: terms.exDiv });
    }
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const requireDirty = args.includes("--require-dirty");
  const here = dirname(fileURLToPath(import.meta.url));
  const path = args.find(a => !a.startsWith("--")) ?? resolve(here, "..", "public/gilt-prices.json");
  const json = JSON.parse(readFileSync(path, "utf8"));
  const r = verifyPrices(json);

  if (r.skipped) {
    console.warn(`verify: ${r.skipped} — nothing checked.`);
    process.exit(requireDirty ? 1 : 0);
  }
  console.log(`verify: settlement ${r.settlement}, ${r.checked} gilts checked, tolerance ±${TOLERANCE}`);
  if (r.missing.length) console.warn(`  no dirty price / not in universe: ${r.missing.join(", ")}`);
  for (const f of r.failures) {
    console.error(`  FAIL ${f.sym}: DMO dirty ${f.dirty} vs clean ${f.clean} + AI ${f.ai.toFixed(6)}` +
      ` = ${f.expected.toFixed(6)} (diff ${f.diff.toFixed(6)}${f.exDiv ? ", ex-div" : ""})`);
  }
  if (r.failures.length) process.exit(1);
  console.log("verify: OK");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
