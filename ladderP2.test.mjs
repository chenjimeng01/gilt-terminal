// Ladder: vs-cash benchmark, P2 options (inflation, coupon-offset sizing,
// idle cash) and P3 guard tests. Live-universe cases use the frozen
// 2026-11-04 price fixture.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildLadder, quickFill, isIndexLinked } from "./src/ladderEngine.js";
import { MASTER } from "./src/giltUniverse.js";

const PRICES = JSON.parse(
  fs.readFileSync(new URL("./test-fixtures/gilt-prices-2026-11-04.json", import.meta.url))
).prices;
const YEAR = 365.25 * 864e5;
const D = s => new Date(s + "T00:00:00Z");
const sym = s => MASTER.find(g => g.sym === s);
const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} got ${a}, want ${b} ±${tol}`);

const EXAMPLE = {
  liabilities: quickFill(42000, 5, "2027-06"),
  accountType: "GIA",
  taxRate: 0,
  preference: "netYield",
  settlement: "2026-11-06",
  universe: MASTER,
  prices: PRICES,
  cashNetRate: 0.03,
};

// ── vs cash ──────────────────────────────────────────────────────────────────
test("vs cash: advantage = PV at the cash rate of every ladder inflow − cost", () => {
  const out = buildLadder(EXAMPLE);
  const pv = out.rungs.flatMap(r => r.cashflows).filter(f => f.t > 0)
    .reduce((s, f) => s + f.cf / Math.pow(1.03, f.t), 0);
  near(out.totals.inflowsPV, pv, 1e-6);
  near(out.totals.cashAdvantage, pv - out.totals.cost, 1e-6);
  // net cost of meeting the liabilities, after valuing the surplus at the cash rate
  near(out.totals.ladderNetCost, out.totals.cashAlternative - out.totals.cashAdvantage, 1e-6);
});

test("vs cash: ladder beats cash exactly when its IRR beats the cash rate", () => {
  // Spec example: portfolio IRR 4.89%. The old figure (PV of liabilities −
  // cost) said the ladder cost £14,154 MORE than cash at 3%, because it
  // ignored ~£22,800 of coupons.
  for (const [acct, tax] of [["GIA", 0], ["GIA", 0.45], ["ISA", 0]]) {
    for (const r of [0.02, 0.03, 0.045, 0.06]) {
      const out = buildLadder({ ...EXAMPLE, accountType: acct, taxRate: tax, cashNetRate: r });
      const irr = out.totals.portfolioIRR;
      assert.equal(out.totals.cashAdvantage > 0, irr > r,
        `${acct} ${tax} cash ${r}: IRR ${irr}, advantage ${out.totals.cashAdvantage}`);
    }
  }
  near(buildLadder(EXAMPLE).totals.cashAdvantage, 8665, 2, "example at 3%");
});

test("vs cash: cash alternative is the PV of the liabilities at the cash rate", () => {
  const out = buildLadder(EXAMPLE);
  const want = out.rungs.reduce((s, r) =>
    s + r.liability / Math.pow(1.03, (r.liabilityDate - D("2026-11-06")) / YEAR), 0);
  near(out.totals.cashAlternative, want, 1e-6);
});

// ── P2-1: inflation-linked liabilities ──────────────────────────────────────
test("inflation: liabilities in today's money grow to their dates", () => {
  const out = buildLadder({ ...EXAMPLE, inflation: 0.025 });
  const last = out.rungs.at(-1);
  const yrs = (D("2031-06-01") - D("2026-11-06")) / YEAR;
  near(last.liability, 42000 * Math.pow(1.025, yrs), 1e-6);
  assert.equal(last.liabilityToday, 42000);
  assert.ok(last.liability > 47000 && last.liability < 47600, `${last.liability}`);
  assert.ok(last.nominal >= last.liability);
  const flat = buildLadder(EXAMPLE);
  assert.equal(flat.rungs.at(-1).liability, 42000);       // default 0 = unchanged
  assert.ok(out.totals.cashAlternative > flat.totals.cashAlternative);
});

// ── P2-2: coupon-offset sizing ──────────────────────────────────────────────
// Every inflow (after-tax coupon, redemption) is assigned to the first
// liability on or after its date and grown there at the cash rate.
function coverage(out, r) {
  const filled = out.rungs.filter(x => !x.unfillable);
  const L = filled.map(x => x.liabilityDate);
  const cov = L.map(() => 0);
  const settle = out.settlement;
  for (const x of filled) for (const f of x.cashflows) {
    if (f.t <= 0) continue;
    const d = new Date(settle.getTime() + f.t * YEAR);
    const j = L.findIndex(l => l >= d - 1000);
    cov[j] += f.cf * Math.pow(1 + r, (L[j] - d) / YEAR);
  }
  return filled.map((x, j) => ({ need: x.liability, have: cov[j] }));
}

for (const [label, extra] of [["GIA 0%", {}], ["GIA 45%", { taxRate: 0.45 }], ["inflation 2.5%", { inflation: 0.025 }]]) {
  test(`coupon-offset sizing meets every liability with < one increment spare — ${label}`, () => {
    const out = buildLadder({ ...EXAMPLE, ...extra, sizing: "couponOffset" });
    for (const { need, have } of coverage(out, 0.03)) {
      assert.ok(have >= need - 1e-6, `short: have ${have}, need ${need}`);
      assert.ok(have - need < 100 * 1.1, `over-sized: have ${have}, need ${need}`);
    }
    const simple = buildLadder({ ...EXAMPLE, ...extra });
    assert.ok(out.totals.nominal < simple.totals.nominal);
    assert.ok(out.totals.cost < simple.totals.cost);
  });
}

test("coupon-offset sizing: example totals", () => {
  const out = buildLadder({ ...EXAMPLE, sizing: "couponOffset" });
  assert.deepEqual(out.rungs.map(r => r.gilt.sym), ["TS27", "TE28", "T29K", "T30", "T31H"]);
  // ~£22.8k of coupons no longer bought twice
  assert.ok(buildLadder(EXAMPLE).totals.cost - out.totals.cost > 15000);
  assert.equal(out.totals.sizing, "couponOffset");
});

test("simple sizing is still the default and unchanged", () => {
  const out = buildLadder(EXAMPLE);
  assert.deepEqual(out.rungs.map(r => r.nominal), [42000, 42000, 42000, 42000, 42000]);
  near(out.totals.cost, 208976, 2);
});

// ── P2-3: idle cash between redemption and liability ────────────────────────
test("idle cash: gap and interest at the cash rate per rung", () => {
  const out = buildLadder(EXAMPLE);
  const ts27 = out.rungs[0];                                // 7 Mar 2027 → 1 Jun 2027
  const yrs = (D("2027-06-01") - D("2027-03-07")) / YEAR;
  near(ts27.idleYears, yrs, 1e-12);
  assert.equal(ts27.idleMonths, 3);
  near(ts27.idleInterest, 42000 * (Math.pow(1.03, yrs) - 1), 1e-6);
});

// ── P3: index-linked guard stays meaningful ─────────────────────────────────
test("universe has no index-linked gilts, and the guard would catch one", () => {
  assert.deepEqual(MASTER.filter(isIndexLinked).map(g => g.sym), []);
  assert.ok(isIndexLinked({ name: "0 1/8% Index-linked Treasury Gilt 2031" }));
  assert.ok(isIndexLinked({ name: "0⅛% Index-Linked Treasury Gilt 2028" }));
  assert.ok(isIndexLinked({ name: "2½% Treasury I/L 2032" }));
  assert.ok(!isIndexLinked({ name: "4¼% Treasury Gilt 2034" }));
});
