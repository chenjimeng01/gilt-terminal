// Band-based income tax on gilt interest (src/ukTax.js) and its use in the
// analyser and ladder. Expected figures are worked by hand in the comments.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  incomeTax, giltInterestTax, bandHeadroom, bandSchedule, depositEquivalent, taxYearStart,
} from "./src/ukTax.js";
import { afterTaxCouponFlows, solveYTM } from "./src/giltMath.js";
import { analyseGilts } from "./src/analyserModel.js";
import { buildLadder, buildLadderWithBands } from "./src/ladderEngine.js";
import { MASTER } from "./src/giltUniverse.js";

const near = (a, b, tol = 0.005) => assert.ok(Math.abs(a - b) <= tol, `${a} ≉ ${b}`);
const P = (otherIncome, otherSavings = 0) => ({ otherIncome, otherSavings });

test("incomeTax: salary only", () => {
  near(incomeTax(30000, 0, 2026).tax, (30000 - 12570) * 0.2); // 3,486
  near(incomeTax(12570, 0, 2026).tax, 0);
});

test("no other income: allowance + starting rate + PSA = £18,570 of interest tax-free", () => {
  near(giltInterestTax(P(0), 18570, 2026), 0);
  near(giltInterestTax(P(0), 19570, 2026), 200);       // next £1,000 at 20%
  near(giltInterestTax(P(0), 19570, 2027), 220);       // 22% from April 2027
});

test("starting rate for savings is cut by non-savings income above the allowance", () => {
  // £15,000 salary: taxable 2,430 → starting rate 2,570, + PSA 1,000 = 3,570 at 0%.
  near(giltInterestTax(P(15000), 3570, 2026), 0);
  near(giltInterestTax(P(15000), 5000, 2026), 1430 * 0.2);   // 286
  // £30,000 salary: starting rate gone, PSA 1,000 only.
  near(giltInterestTax(P(30000), 2000, 2026), 200);
});

test("interest straddling £50,270: PSA falls to £500, rest split basic/higher", () => {
  // Salary 49,000 → taxable 36,430. Interest 3,000 sits on 36,430–39,430.
  // PSA 500 (36,430–36,930), basic 770 (to 37,700), higher 1,730.
  near(giltInterestTax(P(49000), 3000, 2026), 770 * 0.2 + 1730 * 0.4);   // 846
  near(giltInterestTax(P(49000), 3000, 2027), 770 * 0.22 + 1730 * 0.42); // 896
});

test("other savings interest uses the allowances first", () => {
  // Salary 30,000, bank interest 1,000 uses the PSA: all gilt interest at 20%.
  near(giltInterestTax(P(30000, 1000), 2000, 2026), 400);
});

test("personal allowance taper above £100,000 is charged to the gilt interest", () => {
  // Salary 99,000 + 5,000 interest: allowance falls by 2,000 → 800 more tax on
  // salary; PSA 500, 4,500 at 40% = 1,800. Total 2,600 (52%).
  near(giltInterestTax(P(99000), 5000, 2026), 2600);
});

test("additional rate: no PSA", () => {
  near(giltInterestTax(P(150000), 1000, 2026), 450);
  near(giltInterestTax(P(150000), 1000, 2027), 470);
});

test("bandHeadroom: interest at 0% and up to the £50,270 threshold", () => {
  assert.deepEqual(bandHeadroom(P(30000)), { nil: 1000, basic: 19270, toThreshold: 20270 });
  assert.deepEqual(bandHeadroom(P(0)), { nil: 18570, basic: 31700, toThreshold: 50270 });
  assert.deepEqual(bandHeadroom(P(60000)), { nil: 500, basic: 0, toThreshold: 0 });
  // Filling exactly to the threshold is all 0% / basic rate.
  near(giltInterestTax(P(30000), 20270, 2026), 19270 * 0.2);
});

test("taxYearStart: 5 April belongs to the earlier year", () => {
  assert.equal(taxYearStart(new Date("2027-04-05")), 2026);
  assert.equal(taxYearStart(new Date("2027-04-06")), 2027);
});

test("bandSchedule: per-year tax spread evenly over the year's interest", () => {
  const flows = [
    { date: new Date("2026-12-07"), taxable: 1500 },
    { date: new Date("2027-06-07"), taxable: 1500 },
    { date: new Date("2027-12-07"), taxable: 1500 },
  ];
  const s = bandSchedule(flows, P(30000));
  assert.deepEqual(s.byYear.map(y => y.label), ["2026/27", "2027/28"]);
  near(s.byYear[0].tax, 500 * 0.2);     // 1,500 − PSA 1,000
  near(s.byYear[1].tax, 2000 * 0.22);   // 3,000 − PSA 1,000
  near(s.rateAt(new Date("2027-12-07")), 440 / 3000, 1e-9);
  near(s.tax, 540);
});

test("afterTaxCouponFlows / solveYTM accept a rate function", () => {
  const g = { c: 4.125, mat: "2029-07-22" }, settle = new Date("2026-11-05");
  const flat = afterTaxCouponFlows(g, settle, 100, 0.4);
  const fn = afterTaxCouponFlows(g, settle, 100, () => 0.4);
  assert.deepEqual(fn.map(f => f.net), flat.map(f => f.net));
  assert.ok(flat.every(f => f.taxable >= 0 && Math.abs(f.tax - f.taxable * 0.4) < 1e-12));
  near(solveYTM(g.c, g.mat, 100.5, null, () => 0.4, settle), solveYTM(g.c, g.mat, 100.5, null, 0.4, settle), 1e-9);
});

test("depositEquivalent inverts the band tax", () => {
  // £100,000 on deposit, salary 30,000: at 5% gross, 5,000 interest, 800 tax → 4.2% net.
  near(depositEquivalent(4.2, 100000, P(30000), 2026), 5, 1e-6);
  near(depositEquivalent(0.5, 100000, P(30000), 2026), 0.5, 1e-6); // inside the PSA
});

const FIX = JSON.parse(readFileSync(new URL("./test-fixtures/gilt-prices-2026-11-04.json", import.meta.url)));
const SETTLE = new Date("2026-11-05T00:00:00Z");
const analyse = extra => analyseGilts({
  prices: FIX.prices, isLive: true, taxRate: 0.4, settlement: SETTLE, today: SETTLE, ...extra,
});

test("analyser: band yields lie between the 0% and 40% flat yields", () => {
  const flat40 = analyse({}), gross = analyse({ taxRate: 0 });
  const rows = analyse({ taxProfile: { ...P(30000), amount: 100000 } });
  assert.equal(rows.length, flat40.length);
  rows.forEach((r, i) => {
    assert.ok(r.at <= gross[i].at + 1e-9 && r.at >= flat40[i].at - 1e-9, r.sym);
    assert.ok(r.bands.effRate >= 0 && r.bands.effRate < 0.4, r.sym);
    // Tax over the gilt's life is the sum of each year's band tax.
    near(r.bands.tax, r.bands.byYear.reduce((s, y) => s + giltInterestTax(P(30000), y.interest, y.year), 0));
  });
});

test("analyser: a small holding inside the allowances is untaxed; fill cost scales with 1/coupon", () => {
  const rows = analyse({ taxProfile: { ...P(30000), amount: 10000 } });
  const gross = analyse({ taxRate: 0 });
  rows.forEach((r, i) => { // ≤ £10,000 × highest coupon < £1,000 a year
    if (r.bands.annualInterest < 900) near(r.at, gross[i].at, 1e-6);
  });
  const r = rows.find(x => x.c > 0);
  // A full year's coupons on basicCost of this gilt = £20,270.
  near(r.bands.basicCost / ((r.cp + r.ai) / 100) * r.c / 100, 20270, 0.01);
});

const LADDER = {
  liabilities: [{ date: "2028-06", amount: 200000 }, { date: "2029-06", amount: 200000 }, { date: "2030-06", amount: 200000 }],
  accountType: "GIA", settlement: "2026-11-05", universe: MASTER, prices: FIX.prices,
};

for (const extra of [{}, { preference: "netYield" }, { sizing: "couponOffset" }]) {
  test(`ladder with bands ${JSON.stringify(extra)}: converges; tax matches the bands`, () => {
    const profile = P(40000);
    const out = buildLadderWithBands({ ...LADDER, ...extra }, profile);
    assert.ok(out.taxBands.converged);
    const flows = out.rungs.flatMap(r => r.couponFlows);
    // Tax actually deducted from the coupons = band tax on each year's interest.
    near(flows.reduce((s, f) => s + f.tax, 0), out.taxBands.tax, 0.01);
    for (const y of out.taxBands.byYear) near(y.tax, giltInterestTax(profile, y.interest, y.year));
    // Sits between untaxed and 40% flat.
    const lo = buildLadder({ ...LADDER, ...extra, taxRate: 0.4 }).totals.portfolioIRR;
    const hi = buildLadder({ ...LADDER, ...extra, taxRate: 0 }).totals.portfolioIRR;
    assert.ok(out.totals.portfolioIRR > lo && out.totals.portfolioIRR <= hi + 1e-9);
  });
}

test("ladder with bands: ISA is untaxed and carries no band schedule", () => {
  const out = buildLadderWithBands({ ...LADDER, accountType: "ISA" }, P(40000));
  assert.equal(out.taxBands, null);
  assert.equal(out.totals.portfolioIRR, buildLadder({ ...LADDER, accountType: "ISA" }).totals.portfolioIRR);
});
