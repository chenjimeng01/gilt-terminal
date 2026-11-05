// Tests for the shared gilt maths (giltMath.js) and the live-universe ladder
// golden case from the 2026-11 review spec.
// Run: npm test  (runs under both TZ=UTC and TZ=Europe/London)

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { calcAI } from "./src/giltMath.js";
import { buildLadder, quickFill } from "./src/ladderEngine.js";
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
