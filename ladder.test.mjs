// Golden tests for the Ladder Builder engine (spec §6).
// Run: npm test   (node --test, no dependencies)
//
// Frozen fixture: invented but realistic 5-gilt universe, hand-set clean
// prices, fixed settlement date 2026-01-15 → fully deterministic.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLadder, priceGilt, solveIRR, quickFill, taxYearLabel } from "./src/ladderEngine.js";

const U = [
  { name: "0¼% Test Gilt 2027",  c: 0.25, mat: "2027-07-31", px: 94.00, sym: "F27L" },
  { name: "4¼% Test Gilt 2027",  c: 4.25, mat: "2027-09-07", px: 98.50, sym: "F27H" },
  { name: "1% Test Gilt 2029",   c: 1.00, mat: "2029-01-31", px: 89.50, sym: "F29"  },
  { name: "4½% Test Gilt 2030",  c: 4.50, mat: "2030-07-22", px: 99.20, sym: "F30"  },
  { name: "0½% Test Gilt 2032",  c: 0.50, mat: "2032-01-31", px: 82.00, sym: "F32L" },
];

const SETTLE = new Date("2026-01-15"); // Thursday, outside every ex-div window

const base = {
  accountType: "GIA",
  taxRate: 0.45,
  preference: "lowCoupon",
  windowMonths: 12,
  settlement: SETTLE,
  universe: U,
  incrementGBP: 100,
};

// 1. Selection: two candidates in-window (F27L 0.25% and F27H 4.25%);
//    "lowest coupon" picks the 0.25%; the preference flip picks by net yield —
//    at 0% effective tax (ISA) F27H's ~1.6y pull-to-par from 98.50 plus a
//    4.25% coupon out-yields F27L, so the flip changes the pick.
test("selection: lowest coupon vs highest net redemption yield", () => {
  const liabilities = [{ date: "2027-10", amount: 50000 }];

  const low = buildLadder({ ...base, liabilities });
  assert.equal(low.rungs[0].gilt.sym, "F27L");

  const net = buildLadder({ ...base, liabilities, accountType: "ISA", preference: "netYield" });
  assert.equal(net.rungs[0].gilt.sym, "F27H");
});

// 2. Sizing/rounding to the platform increment.
test("sizing: £50,000 → £50,000 nominal; £50,050 → £50,100", () => {
  const a = buildLadder({ ...base, liabilities: [{ date: "2029-02", amount: 50000 }] });
  assert.equal(a.rungs[0].nominal, 50000);

  const b = buildLadder({ ...base, liabilities: [{ date: "2029-02", amount: 50050 }] });
  assert.equal(b.rungs[0].nominal, 50100);
});

// 3. Cost: hand-computed dirty × nominal for the F29 rung.
//    F29: 1% coupon, matures 31 Jan 2029, clean 89.50. At settlement
//    15 Jan 2026 the previous coupon was 31 Jul 2025, the next 31 Jan 2026:
//    period = 184 days, elapsed = 168 days (Actual/Actual), so
//      accrued = (1.00 / 2) × 168/184        = 0.456522 per £100
//      dirty   = 89.50 + 0.456522            = 89.956522
//      cost    = 50,000 × 89.956522 / 100    = £44,978.26
//    (±£1 tolerance absorbs sub-hour DST jitter in the day counts.)
test("cost: hand-computed dirty price × nominal", () => {
  const r = buildLadder({ ...base, liabilities: [{ date: "2029-02", amount: 50000 }] }).rungs[0];
  assert.equal(r.gilt.sym, "F29");
  assert.ok(Math.abs(r.ai - 0.456522) < 0.005, `ai ${r.ai}`);
  assert.ok(Math.abs(r.cost - 44978.26) < 1, `cost ${r.cost}`);
});

// 4. Tax: 45% GIA vs ISA on the same rung — every coupon cashflow differs by
//    exactly the tax; redemption identical.
test("tax: GIA coupons = ISA coupons × (1 − 45%); redemption unchanged", () => {
  const liabilities = [{ date: "2029-02", amount: 50000 }];
  const gia = buildLadder({ ...base, liabilities }).rungs[0];
  const isa = buildLadder({ ...base, liabilities, accountType: "ISA" }).rungs[0];

  assert.equal(gia.couponFlows.length, isa.couponFlows.length);
  gia.couponFlows.forEach((c, i) => {
    assert.ok(Math.abs(c.net - isa.couponFlows[i].net * 0.55) < 1e-9);
  });
  // final cashflow is the redemption in both
  assert.equal(gia.cashflows.at(-1).cf, isa.cashflows.at(-1).cf);
  assert.equal(gia.cashflows.at(-1).cf, 50000);
});

// 5. IRR: three cashflows, verified by hand.
//    −96 at t=0, +2 at t=1, +102 at t=2. With x = 1+r:
//      96x² − 2x − 102 = 0  →  x = (2 + √(4 + 4·96·102)) / 192
//                               = (2 + √39172) / 192 = 1.0412457
//    so r = 4.1246% (4dp).
test("IRR: bisection matches closed-form to 4dp", () => {
  const r = solveIRR([{ t: 0, cf: -96 }, { t: 1, cf: 2 }, { t: 2, cf: 102 }]);
  assert.ok(Math.abs(r - 0.0412457) < 1e-6, `irr ${r}`);
});

// 6. Gap handling: liability in 2040 with the longest fixture gilt maturing
//    2032 → rung unfillable even after widening to 36 months, excluded from
//    totals, warning set. A 2028-12 liability with a 6-month window has no
//    match until the window widens to 18 months → gap-filled, not unfillable.
test("gap handling: unfillable rung excluded; widening marks gap-filled", () => {
  const out = buildLadder({
    ...base,
    liabilities: [
      { date: "2040-06", amount: 25000 },
      { date: "2029-02", amount: 50000 },
    ],
  });
  const [ok, gone] = out.rungs; // sorted by date: 2029 first
  assert.equal(gone.unfillable, true);
  assert.equal(ok.unfillable, false);
  assert.equal(out.totals.liability, 50000);            // 2040 excluded
  assert.ok(out.warnings.some(w => /excluded from totals/.test(w)));

  const gap = buildLadder({
    ...base,
    windowMonths: 6,
    liabilities: [{ date: "2028-12", amount: 10000 }],
  }).rungs[0];
  assert.equal(gap.unfillable, false);
  assert.equal(gap.gapFilled, true);
  assert.equal(gap.effectiveWindowMonths, 18);          // 6 → 12 → 18 finds F27H/F27L
});

// 7. Ex-div edge: F29's next coupon is Sat 31 Jan 2026; seven business days
//    before is Thu 22 Jan 2026. Settling Mon 26 Jan is inside the window →
//    the buyer forgoes that coupon and accrued is negative.
test("ex-div: settlement inside window skips next coupon, negative accrued", () => {
  const g = U[2]; // F29
  const inside = priceGilt(g, 89.50, new Date("2026-01-26"));
  assert.equal(inside.exDiv, true);
  assert.ok(inside.ai < 0, `ai ${inside.ai}`);
  assert.ok(inside.coupons[0] > new Date("2026-01-31"), "next coupon skipped");

  const outside = priceGilt(g, 89.50, new Date("2026-01-15"));
  assert.equal(outside.exDiv, false);
  assert.ok(outside.ai > 0);
  assert.equal(outside.coupons.length, inside.coupons.length + 1); // Jan-2026 coupon retained
});

// Quick-fill helper expands "£20k per year for 3 years starting 2028-03".
test("quick-fill expands to one rung per year", () => {
  assert.deepEqual(quickFill(20000, 3, "2028-03"), [
    { date: "2028-03", amount: 20000 },
    { date: "2029-03", amount: 20000 },
    { date: "2030-03", amount: 20000 },
  ]);
});

// UK tax-year bucketing used by the surplus-income note.
test("tax year label straddles 6 April", () => {
  assert.equal(taxYearLabel(new Date("2027-04-05")), "2026/27");
  assert.equal(taxYearLabel(new Date("2027-04-06")), "2027/28");
});
