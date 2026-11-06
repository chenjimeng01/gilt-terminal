// One-off manual (live) prices typed in by the user: validation, settlement,
// and that both the analyser and the ladder price them correctly.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { makeManualPrice, ladderPriceInputs } from "./src/manualPrices.js";
import { analyseGilts } from "./src/analyserModel.js";
import { settlementTerms, solveYTM } from "./src/giltMath.js";
import { buildLadder } from "./src/ladderEngine.js";
import { MASTER } from "./src/giltUniverse.js";

const PRICES = JSON.parse(
  fs.readFileSync(new URL("./test-fixtures/gilt-prices-2026-11-04.json", import.meta.url))
).prices;
const D = s => new Date(s + "T00:00:00Z");
const sym = s => MASTER.find(g => g.sym === s);
const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} got ${a}, want ${b} ±${tol}`);

// Friday 6 Nov 2026, mid-morning: a price typed now settles Monday 9 Nov (T+1).
const NOW = new Date("2026-11-06T10:30:00Z");
const FILE_SETTLE = D("2026-11-05");           // file asOf 2026-11-04 → T+1
const TS27 = sym("TS27"), T29K = sym("T29K");

const base = {
  prices: PRICES, isLive: true, taxRate: 0.45, settlement: FILE_SETTLE,
  liveDirty: {}, today: NOW,
};
const row = (rows, s) => rows.find(r => r.sym === s);

// ── Validation and settlement ────────────────────────────────────────────────
test("manual price settles T+1 from when it is entered, not from the file date", () => {
  const m = makeManualPrice(TS27, "99.90", "clean", { now: NOW });
  assert.equal(m.ok, true);
  assert.equal(m.settlement, "2026-11-09");    // Fri → Mon
  const t = settlementTerms(TS27.c, TS27.mat, D("2026-11-09"));
  near(m.ai, t.ai, 1e-12);
  near(m.clean, 99.9, 1e-12);
  near(m.dirty, 99.9 + t.ai, 1e-12);
});

test("a dirty price converts to the same clean price at that settlement", () => {
  const t = settlementTerms(TS27.c, TS27.mat, D("2026-11-09"));
  const m = makeManualPrice(TS27, String(99.9 + t.ai), "dirty", { now: NOW });
  near(m.clean, 99.9, 1e-9);
  assert.equal(m.kind, "dirty");
});

test("ex-dividend: a dirty price below clean gives negative accrued", () => {
  // Thu 12 Nov → settles Fri 13 Nov, inside T29K's ex-div window (coupon 22 Nov)
  const m = makeManualPrice(T29K, "98.80", "dirty", { now: new Date("2026-11-12T09:00:00Z") });
  assert.equal(m.exDiv, true);
  assert.ok(m.ai < 0);
  near(m.clean, 98.8 - m.ai, 1e-12);
  assert.ok(m.clean > 98.8);
});

test("rejects input that isn't a usable price", () => {
  for (const bad of ["", "abc", "0", "-5", "300", "1e9", "99,50"]) {
    const m = makeManualPrice(TS27, bad, "clean", { now: NOW });
    assert.equal(m.ok, false, `accepted ${JSON.stringify(bad)}`);
    assert.ok(m.error);
  }
  const matured = makeManualPrice({ ...TS27, mat: "2026-10-22" }, "99", "clean", { now: NOW });
  assert.equal(matured.ok, false);
});

test("warns (but accepts) a price far from the reference price", () => {
  const m = makeManualPrice(TS27, "94.00", "clean", { now: NOW, referenceClean: 99.84 });
  assert.equal(m.ok, true);
  assert.match(m.warning, /5\.8% below/);
  assert.equal(makeManualPrice(TS27, "99.90", "clean", { now: NOW, referenceClean: 99.84 }).warning, null);
});

// ── Analyser ─────────────────────────────────────────────────────────────────
test("analyser: overridden gilt is priced at its own settlement", () => {
  const m = makeManualPrice(TS27, "99.90", "clean", { now: NOW });
  const rows = analyseGilts({ ...base, manual: { TS27: m } });
  const r = row(rows, "TS27");
  const s = D("2026-11-09");
  const ai = settlementTerms(TS27.c, TS27.mat, s).ai;
  assert.equal(r.priceSource, "manual");
  near(r.cp, 99.9, 1e-12);
  near(r.ai, ai, 1e-12);
  near(r.grossYTM, solveYTM(TS27.c, TS27.mat, 99.9, ai, 0, s), 1e-12);
  near(r.at, solveYTM(TS27.c, TS27.mat, 99.9, ai, 0.45, s), 1e-12);
  assert.equal(r.settlement.toISOString().slice(0, 10), "2026-11-09");
});

test("analyser: clean and equivalent dirty entries give identical yields", () => {
  const a = makeManualPrice(TS27, "99.90", "clean", { now: NOW });
  const b = makeManualPrice(TS27, String(a.dirty), "dirty", { now: NOW });
  const ra = row(analyseGilts({ ...base, manual: { TS27: a } }), "TS27");
  const rb = row(analyseGilts({ ...base, manual: { TS27: b } }), "TS27");
  near(ra.grossYTM, rb.grossYTM, 1e-9);
  near(ra.at, rb.at, 1e-9);
});

test("analyser: the file's DMO dirty price is not used for an overridden gilt", () => {
  const m = makeManualPrice(TS27, "99.90", "clean", { now: NOW });
  const withDirty = { ...base, liveDirty: { TS27: 120, TE28: 100.3 } };
  const r = row(analyseGilts({ ...withDirty, manual: { TS27: m } }), "TS27");
  near(r.ai, m.ai, 1e-12);                                   // not 120 − 99.9
  // …but other gilts still use theirs
  near(row(analyseGilts({ ...withDirty, manual: { TS27: m } }), "TE28").ai, 100.3 - PRICES.TE28, 1e-12);
});

test("analyser: other gilts are untouched by an override", () => {
  const m = makeManualPrice(TS27, "99.90", "clean", { now: NOW });
  const before = analyseGilts({ ...base, manual: {} });
  const after = analyseGilts({ ...base, manual: { TS27: m } });
  for (const r of before) {
    if (r.sym === "TS27") continue;
    const a = row(after, r.sym);
    assert.equal(a.cp, r.cp); assert.equal(a.at, r.at); assert.equal(a.priceSource, r.priceSource);
  }
  assert.equal(row(before, "TS27").priceSource, "file");
});

test("analyser: overrides also work on snapshot (non-live) prices", () => {
  const m = makeManualPrice(TS27, "99.90", "clean", { now: NOW });
  const r = row(analyseGilts({ ...base, prices: {}, isLive: false, manual: { TS27: m } }), "TS27");
  assert.equal(r.priceSource, "manual");
  near(r.cp, 99.9, 1e-12);
});

// ── Ladder ───────────────────────────────────────────────────────────────────
test("ladder: manual clean price used at the ladder's own settlement; its DMO dirty dropped", () => {
  const m = makeManualPrice(TS27, "99.90", "clean", { now: NOW });
  const inputs = ladderPriceInputs({
    prices: PRICES, isLive: true,
    liveDirty: { TS27: 100.46, TE28: 100.27 }, dirtySettlement: "2026-11-06",
    manual: { TS27: m },
  });
  assert.equal(inputs.prices.TS27, 99.9);
  assert.equal(inputs.prices.TE28, PRICES.TE28);
  assert.ok(!("TS27" in inputs.dirtyPrices));
  assert.equal(inputs.dirtyPrices.TE28, 100.27);
  assert.deepEqual(inputs.manualSyms, ["TS27"]);

  const out = buildLadder({
    liabilities: [{ date: "2027-06", amount: 42000 }], accountType: "GIA", taxRate: 0,
    preference: "netYield", settlement: "2026-11-06", universe: [TS27], ...inputs,
  });
  const r = out.rungs[0];
  const ai = settlementTerms(TS27.c, TS27.mat, D("2026-11-06")).ai;
  near(r.cleanPx, 99.9, 1e-12);
  near(r.dirtyPx, 99.9 + ai, 1e-12);                        // not the DMO 100.46
  near(r.atYTM, solveYTM(TS27.c, TS27.mat, 99.9, ai, 0, D("2026-11-06")), 1e-12);
});

test("ladder: no overrides → inputs are exactly the file's", () => {
  const inputs = ladderPriceInputs({
    prices: PRICES, isLive: true, liveDirty: { TS27: 100.46 }, dirtySettlement: "2026-11-06", manual: {},
  });
  assert.deepEqual(inputs.prices, PRICES);
  assert.deepEqual(inputs.dirtyPrices, { TS27: 100.46 });
  assert.equal(inputs.dirtySettlement, "2026-11-06");
});
