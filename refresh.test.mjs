// Tests for the DMO row parser in scripts/refresh-gilt-prices.js (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGiltRow, nextBusinessDay } from "./scripts/refresh-gilt-prices.js";

test("cum-div row: clean and dirty read in column order", () => {
  const r = parseGiltRow(["3¾% Treasury Gilt 2027", 99.84, 100.462, "GB00BMBL1G81"]);
  assert.deepEqual(r, { name: "3¾% Treasury Gilt 2027", isin: "GB00BMBL1G81", clean: 99.84, dirty: 100.462 });
});

test("ex-div row (dirty < clean) is not swapped", () => {
  const r = parseGiltRow(["4% Treasury Gilt 2029", 98.9, 98.79, "GB00BMF9LG83"]);
  assert.equal(r.clean, 98.9);
  assert.equal(r.dirty, 98.79);
});

test("non-price numbers (e.g. an Excel date serial) are ignored", () => {
  const r = parseGiltRow([46330, "4% Treasury Gilt 2029", "98.90", "98.79", "GB00BMF9LG83"]);
  assert.equal(r.clean, 98.9);
  assert.equal(r.dirty, 98.79);
});

test("header and blank rows are skipped", () => {
  assert.equal(parseGiltRow(["Gilt Name", "Clean Price", "Dirty Price", "ISIN"]), null);
  assert.equal(parseGiltRow([null, null]), null);
});

// ── Data check: npm run verify ───────────────────────────────────────────────
import { verifyPrices } from "./scripts/verify-gilt-prices.js";
import { settlementTerms } from "./src/giltMath.js";
import { MASTER } from "./src/giltUniverse.js";

function fileWithDirty(settlement, bump = {}) {
  const prices = {}, dirty = {};
  for (const g of MASTER) {
    const t = settlementTerms(g.c, g.mat, new Date(settlement + "T00:00:00Z"));
    if (!t) continue;
    prices[g.sym] = g.px;
    dirty[g.sym] = +(g.px + t.ai + (bump[g.sym] ?? 0)).toFixed(6);
  }
  return { asOf: "2026-11-04", settlement, prices, dirty };
}

test("verify: passes when dirty = clean + accrued at settlement", () => {
  const r = verifyPrices(fileWithDirty("2026-11-05"));
  assert.equal(r.failures.length, 0);
  assert.ok(r.checked >= 60);
});

test("verify: flags a gilt whose dirty price is off by more than 0.005", () => {
  const r = verifyPrices(fileWithDirty("2026-11-05", { TS27: 0.01 }));
  assert.deepEqual(r.failures.map(f => f.sym), ["TS27"]);
});

test("verify: catches the old Jan–Jun accrued-interest bug", () => {
  // Dirty prices built with the pre-fix accrued for TS27 (2.486 vs 0.622).
  const r = verifyPrices(fileWithDirty("2026-11-05", { TS27: 2.486 - 0.622 }));
  assert.ok(r.failures.some(f => f.sym === "TS27"));
});

test("verify: ex-div gilts (negative accrued) pass", () => {
  const r = verifyPrices(fileWithDirty("2026-11-13"));   // T29K ex-div
  assert.equal(r.failures.length, 0);
});

test("verify: a file without dirty prices is reported, not silently passed", () => {
  const r = verifyPrices({ asOf: "2026-11-04", prices: { TS27: 99.84 } });
  assert.equal(r.checked, 0);
  assert.match(r.skipped, /no dirty prices/);
});

test("refresh: settlement is the next business day after asOf", () => {
  const iso = d => d.toISOString().slice(0, 10);
  assert.equal(iso(nextBusinessDay(new Date("2026-11-04T00:00:00Z"))), "2026-11-05");
  assert.equal(iso(nextBusinessDay(new Date("2026-11-06T00:00:00Z"))), "2026-11-09");
});
