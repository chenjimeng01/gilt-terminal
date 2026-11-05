// Tests for the shared gilt maths (giltMath.js) and the live-universe ladder
// golden case from the 2026-11 review spec.
// Run: npm test  (runs under both TZ=UTC and TZ=Europe/London)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { calcAI, solveYTM, futureCouponDates, addMonthsUTC, settlementTerms, afterTaxCouponFlows, priceSettlement } from "./src/giltMath.js";
import { buildLadder, quickFill, priceGilt } from "./src/ladderEngine.js";
import { MASTER } from "./src/giltUniverse.js";

const FIXTURE = JSON.parse(
  fs.readFileSync(new URL("./test-fixtures/gilt-prices-2026-11-04.json", import.meta.url))
);
const PRICES = FIXTURE.prices;
const D = s => new Date(s + "T00:00:00Z");
const sym = s => MASTER.find(g => g.sym === s);
const near = (a, b, tol, msg) =>
  assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} got ${a}, want ${b} ±${tol}`);

// Independent reference: enumerate both coupon dates of every year explicitly
// (no month arithmetic), take the last ≤ t and first > t, Actual/Actual.
function refAI(coupon, [m1, m2], day, t) {
  const all = [];
  for (let y = t.getUTCFullYear() - 1; y <= t.getUTCFullYear() + 1; y++) {
    all.push(Date.UTC(y, m1, day), Date.UTC(y, m2, day));
  }
  all.sort((a, b) => a - b);
  const next = all.find(d => d > t.getTime());
  const prev = all.filter(d => d <= t.getTime()).at(-1);
  return (coupon / 2) * (t - prev) / (next - prev);
}

// ── P0: accrued interest ─────────────────────────────────────────────────────
// One synthetic gilt per coupon pattern; dates in each half-year, just after
// each coupon, and 31 December.
const PATTERNS = [
  { mat: "2040-01-31", months: [0, 6],  day: 31, label: "Jan/Jul 31" },
  { mat: "2040-01-22", months: [0, 6],  day: 22, label: "Jan/Jul 22" },
  { mat: "2040-03-07", months: [2, 8],  day: 7,  label: "Mar/Sep 7"  },
  { mat: "2040-06-07", months: [5, 11], day: 7,  label: "Jun/Dec 7"  },
  { mat: "2040-04-22", months: [3, 9],  day: 22, label: "Apr/Oct 22" },
  { mat: "2040-05-22", months: [4, 10], day: 22, label: "May/Nov 22" },
];

for (const p of PATTERNS) {
  test(`calcAI matches Actual/Actual reference — ${p.label}`, () => {
    const [m1, m2] = p.months;
    const pad = n => String(n).padStart(2, "0");
    const dates = [
      `2026-${pad(m1 + 1)}-${pad(p.day)}`,          // on coupon 1 → AI 0
      `2026-${pad(m2 + 1)}-${pad(p.day)}`,          // on coupon 2 → AI 0
      // just after each coupon (day+1 — always valid: 31 Jan → 1 Feb handled by Date)
      new Date(Date.UTC(2026, m1, p.day + 1)).toISOString().slice(0, 10),
      new Date(Date.UTC(2026, m2, p.day + 1)).toISOString().slice(0, 10),
      // middle of each half-year
      new Date(Date.UTC(2026, m1 + 3, 1)).toISOString().slice(0, 10),
      new Date(Date.UTC(2026, m2 + 3, 1)).toISOString().slice(0, 10),
      "2026-12-31",
      "2027-01-01",
    ];
    for (const ds of dates) {
      const t = D(ds);
      near(calcAI(4, p.mat, t), refAI(4, p.months, p.day, t), 1e-9, `${p.label} @ ${ds}`);
    }
  });
}

test("calcAI: 0 ≤ AI ≤ c/2 for every gilt, every day of 2026–2027", () => {
  for (let t = D("2026-01-01"); t <= D("2027-12-31"); t = new Date(t.getTime() + 86400000)) {
    for (const g of MASTER) {
      if (D(g.mat) <= t) continue;
      const ai = calcAI(g.c, g.mat, t);
      assert.ok(ai >= 0 && ai <= g.c / 2 + 1e-12,
        `${g.sym} @ ${t.toISOString().slice(0, 10)}: AI ${ai} outside [0, ${g.c / 2}]`);
    }
  }
});

test("calcAI golden values at settlement 2026-11-06", () => {
  const t = D("2026-11-06");
  const want = { TS27: 0.622, T27A: 1.121, TE28: 0.725, TG40: 1.165, TR27: 1.765 };
  for (const [s, v] of Object.entries(want)) {
    const g = sym(s);
    near(calcAI(g.c, g.mat, t), v, 0.002, s);
  }
});

test("calcAI: June/December gilts after the December coupon (missed by old candidates)", () => {
  const t = D("2026-12-15");
  // TS28 4½% 7 Jun 2028: prev 7 Dec 2026, next 7 Jun 2027 → 8/182 days
  near(calcAI(4.5, "2028-06-07", t), 2.25 * 8 / 182, 1e-9, "TS28");
});

// ── P1-4: UTC month arithmetic with month-end clamp ──────────────────────────
const iso = d => d.toISOString().slice(0, 10);

test("addMonthsUTC clamps to month end", () => {
  assert.equal(iso(addMonthsUTC(D("2029-08-31"), -6)), "2029-02-28");
  assert.equal(iso(addMonthsUTC(D("2028-08-31"), -6)), "2028-02-29");
  assert.equal(iso(addMonthsUTC(D("2027-01-31"), 6)), "2027-07-31");
  assert.equal(iso(addMonthsUTC(D("2027-03-31"), -1)), "2027-02-28");
  assert.equal(iso(addMonthsUTC(D("2027-12-15"), 1)), "2028-01-15");
});

test("futureCouponDates: month-end maturity keeps month-end dates (no drift)", () => {
  const ds = futureCouponDates("2029-08-31", D("2026-11-06")).map(iso);
  assert.deepEqual(ds, ["2027-02-28", "2027-08-31", "2028-02-29", "2028-08-31", "2029-02-28", "2029-08-31"]);
});

test("calcAI: month-end gilt accrues over the clamped period", () => {
  // 4% 31 Aug 2029, settle 6 Nov 2026: prev 31 Aug 2026, next 28 Feb 2027 → 67/181
  near(calcAI(4, "2029-08-31", D("2026-11-06")), 2 * 67 / 181, 1e-12);
});

// ── P0: solveYTM must not clamp ──────────────────────────────────────────────
test("solveYTM: overpriced gilt gives a negative yield, never the 0.01% floor", () => {
  const t = D("2026-11-06");
  // 4% 7 Mar 2027 at 110 clean + 1.0 AI: only 102 left to receive, so yield is deeply negative.
  const y = solveYTM(4, "2027-03-07", 110, 1.0, 0, t);
  assert.ok(y === null || y < 0, `got ${y}`);
  assert.notEqual(y, 0.01);
  // 102 / 111 over 121/181 = 0.6685 coupon periods (DMO timing):
  // (1 + r/2)^0.6685 = 0.91892 → r ≈ −23.76%
  near(y, -23.76, 0.01);
});

test("solveYTM: no root in [−50%, 100%] → null, not a boundary value", () => {
  const t = D("2026-11-06");
  assert.equal(solveYTM(4, "2027-03-07", 1000, 0, 0, t), null);  // absurdly expensive
  assert.equal(solveYTM(4, "2027-03-07", 1, 0, 0, t), null);     // absurdly cheap
});

test("solveYTM: ordinary gilt (TR27 at fixture price, DMO timing)", () => {
  const t = D("2026-11-06");
  const g = sym("TR27");
  near(solveYTM(g.c, g.mat, PRICES.TR27, calcAI(g.c, g.mat, t), 0, t), 4.562, 0.001);
});

// ── P0: ladder golden case (spec example) ────────────────────────────────────
const EXAMPLE = {
  liabilities: quickFill(42000, 5, "2027-06"),
  accountType: "GIA",
  taxRate: 0,
  preference: "netYield",
  settlement: "2026-11-06",
  universe: MASTER,
  prices: PRICES,
};

test("ladder golden: £42k/yr Jun 2027–Jun 2031, GIA 0%, net yield", () => {
  const out = buildLadder(EXAMPLE);
  assert.deepEqual(out.rungs.map(r => r.gilt.sym), ["TS27", "TE28", "T29K", "T30", "T31H"]);
  const ts27 = out.rungs[0];
  near(ts27.dirtyPx, 100.46, 0.01, "TS27 dirty");
  near(ts27.netIRR * 100, 4.31, 0.02, "TS27 IRR");
  near(out.totals.cost, 208976, 2, "cost");
  near(out.totals.portfolioIRR * 100, 4.892, 0.005, "portfolio IRR");
});

test("ladder: a candidate with no solvable yield is ranked last and warned about", () => {
  const out = buildLadder({
    ...EXAMPLE,
    liabilities: [{ date: "2027-06", amount: 42000 }],
    prices: { ...PRICES, T27A: 500 },              // T27A absurdly overpriced
  });
  assert.equal(out.rungs[0].gilt.sym, "TS27");
  assert.deepEqual(out.rungs[0].unsolvedCandidates, ["T27A"]);
  assert.ok(out.warnings.some(w => /T27A/.test(w)), out.warnings.join("; "));
});

// DMO timing: a flow on the k-th scheduled coupon date after settlement is
// discounted over f + k half-years, f = days to next coupon / days in period.
function periods(d, settle, terms) {
  const f = (terms.next - settle) / (terms.next - terms.prev);
  return f + terms.dates.findIndex(x => x.getTime() === d.getTime());
}

// ── P1-1 / P1-2 / P1-3: ex-dividend and coupon tax, shared by both views ─────
// T29K: 4% 22 May 2029. Next coupon Sun 22 Nov 2026; 7 business days before
// is Thu 12 Nov 2026, so settling Fri 13 Nov is ex-div, Wed 11 Nov is not.
const T29K = sym("T29K");
const EXDIV = D("2026-11-13"), CUMDIV = D("2026-11-11");

test("settlementTerms: ex-div window, negative AI, forgone coupon", () => {
  const ex = settlementTerms(T29K.c, T29K.mat, EXDIV);
  assert.equal(ex.exDiv, true);
  near(ex.ai, -2 * 9 / 184, 1e-12);                     // 13→22 Nov over 22 May→22 Nov
  assert.equal(iso(ex.coupons[0]), "2027-05-22");
  const cum = settlementTerms(T29K.c, T29K.mat, CUMDIV);
  assert.equal(cum.exDiv, false);
  near(cum.ai, 2 * 173 / 184, 1e-12);
  assert.equal(iso(cum.coupons[0]), "2026-11-22");
  // analyser and ladder agree
  assert.deepEqual(priceGilt(T29K, 98.9, EXDIV).coupons, ex.coupons);
  near(priceGilt(T29K, 98.9, EXDIV).ai, ex.ai, 0);
});

test("afterTaxCouponFlows: AIS relief on a cum-div first coupon", () => {
  const f = afterTaxCouponFlows(T29K, CUMDIV, 100, 0.45);
  const ai = 2 * 173 / 184;
  near(f[0].tax, 0.45 * (2 - ai), 1e-12, "first coupon taxed on c/2 − AI");
  near(f[1].tax, 0.45 * 2, 1e-12, "later coupons taxed in full");
  const noAis = afterTaxCouponFlows(T29K, CUMDIV, 100, 0.45, { ais: false });
  near(noAis[0].tax, 0.45 * 2, 1e-12, "ais:false taxes every coupon in full");
});

test("afterTaxCouponFlows: ex-div buyer is taxed on the rebate interest", () => {
  const f = afterTaxCouponFlows(T29K, EXDIV, 100, 0.45);
  const rebate = 2 * 9 / 184;
  assert.equal(f[0].rebate, true);
  assert.equal(iso(f[0].date), "2026-11-22");
  near(f[0].net, -0.45 * rebate, 1e-12);
  near(f[1].tax, 0.45 * 2, 1e-12);
  const noAis = afterTaxCouponFlows(T29K, EXDIV, 100, 0.45, { ais: false });
  assert.ok(!noAis.some(x => x.rebate));
});

test("solveYTM excludes the forgone coupon when ex-div", () => {
  // At 0% tax, the yield must reprice exactly the coupons the buyer receives.
  const t = EXDIV, clean = 98.9;
  const terms = settlementTerms(T29K.c, T29K.mat, t);
  const y = solveYTM(T29K.c, T29K.mat, clean, terms.ai, 0, t) / 100;
  const flows = [...terms.coupons.map(d => ({ d, cf: 2 })), { d: D(T29K.mat), cf: 100 }];
  const pv = flows.reduce((s, { d, cf }) => s + cf / Math.pow(1 + y / 2, periods(d, t, terms)), 0);
  near(pv, clean + terms.ai, 1e-6);
});

test("ladder selection uses the real (negative) AI and paid coupons", () => {
  const out = buildLadder({ ...EXAMPLE, universe: [T29K], settlement: EXDIV,
    liabilities: [{ date: "2029-06", amount: 10000 }] });
  const r = out.rungs[0];
  const p = priceGilt(T29K, PRICES.T29K, EXDIV);
  const honest = solveYTM(T29K.c, T29K.mat, PRICES.T29K, p.ai, 0, EXDIV);
  // Old metric: AI floored at 0 and the forgone 22 Nov coupon still counted.
  const full = settlementTerms(T29K.c, T29K.mat, EXDIV).dates;
  const flows = [...full.map(d => ({ d, cf: 2 })), { d: D(T29K.mat), cf: 100 }];
  const exTerms = settlementTerms(T29K.c, T29K.mat, EXDIV);
  const pvAt = y => flows.reduce((s, { d, cf }) =>
    s + cf / Math.pow(1 + y / 2, periods(d, EXDIV, exTerms)), 0);
  let lo = -0.5, hi = 1;
  while (hi - lo > 1e-12) { const m = (lo + hi) / 2; pvAt(m) > PRICES.T29K ? (lo = m) : (hi = m); }
  const old = lo * 100;
  assert.ok(old > honest, "old metric overstated ex-div yield");
  near(r.atYTM, honest, 1e-9);
});

test("ladder rung IRR agrees with the selection yield (same tax model)", () => {
  // Single rung, 45% GIA, nominal = liability exactly: rung IRR (annual) must
  // equal the after-tax YTM (semi-annual) converted to annual.
  for (const settle of [CUMDIV, EXDIV]) {
    const out = buildLadder({ ...EXAMPLE, universe: [T29K], taxRate: 0.45, settlement: settle,
      liabilities: [{ date: "2029-06", amount: 10000 }] });
    const r = out.rungs[0];
    assert.equal(r.gilt.sym, "T29K");
    const annual = Math.pow(1 + r.atYTM / 200, 2) - 1;
    near(r.netIRR, annual, 2e-4, `@ ${iso(settle)}`);
  }
});

// ── P1-7: DMO yield convention ───────────────────────────────────────────────
// DMO "Formulae for calculating gilt prices from yields": for a conventional
// gilt with n coupons left, v = 1/(1 + y/2), r = days settlement → next coupon,
// s = days in the current coupon period,
//   dirty = v^(r/s) · ( d1 + c/2 · Σ_{k=1}^{n−1} v^k + 100 · v^(n−1) )
// with d1 = c/2 cum-div, 0 ex-div. Written out here independently of the code.
function dmoDirty(c, matStr, settle, y) {
  const t = settlementTerms(c, matStr, settle);
  const v = 1 / (1 + y / 2), n = t.dates.length;
  const r = (t.next - settle) / 864e5, sDays = (t.next - t.prev) / 864e5;
  let body = t.exDiv ? 0 : c / 2;
  for (let k = 1; k <= n - 1; k++) body += (c / 2) * Math.pow(v, k);
  body += 100 * Math.pow(v, n - 1);
  return { dirty: Math.pow(v, r / sDays) * body, ai: t.ai };
}

test("solveYTM gross yield inverts the DMO price formula", () => {
  const cases = [
    ["TS27", D("2026-11-06")], ["TE28", D("2026-11-06")], ["TN34", D("2026-11-06")],
    ["TR73", D("2026-11-06")], ["T29K", EXDIV], ["T29K", CUMDIV], ["TS28", D("2027-05-31")],
  ];
  for (const [s, settle] of cases) {
    const g = sym(s);
    for (const y of [0.0425, 0.01, -0.01]) {
      const { dirty, ai } = dmoDirty(g.c, g.mat, settle, y);
      near(solveYTM(g.c, g.mat, dirty - ai, ai, 0, settle) / 100, y, 1e-8, `${s} @ ${iso(settle)} y=${y}`);
    }
  }
});

// ── P1-5: analyser settlement = next business day after the price date ──────
test("priceSettlement: T+1 business day after asOf (or after today)", () => {
  assert.equal(iso(priceSettlement("2026-11-04")), "2026-11-05");          // Wed → Thu
  assert.equal(iso(priceSettlement("2026-11-06")), "2026-11-09");          // Fri → Mon
  assert.equal(iso(priceSettlement(null, new Date("2026-11-07T22:30:00Z"))), "2026-11-09"); // Sat → Mon
  assert.equal(iso(priceSettlement(null, new Date("2026-11-05T09:15:00Z"))), "2026-11-06");
});
