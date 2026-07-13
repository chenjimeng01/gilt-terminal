// Ladder Builder engine — pure functions, no React, no fetching.
// Runs identically in the browser (LadderView.jsx) and Node (ladder.test.mjs).
// Reuses the analyser's maths (giltMath.js) for accrued interest and the
// after-tax-YTM selection metric; the rung cashflow/IRR model follows the
// spec (§3.4): every coupon taxed in full, redemption at par untaxed.

import { futureCouponDates, calcAI, solveYTM } from "./giltMath.js";

const MS_DAY = 86400000;
const YEAR = 365.25 * MS_DAY;
const EX_DIV_BUSINESS_DAYS = 7;

// ── Date helpers ──────────────────────────────────────────────────────────────

export function toDate(d) {
  if (d instanceof Date) return d;
  if (/^\d{4}-\d{2}$/.test(d)) return new Date(d + "-01"); // month granularity → 1st
  return new Date(d);
}

function isWeekend(d) {
  const wd = d.getUTCDay();
  return wd === 0 || wd === 6;
}

/** Next business day strictly after `d` (weekends skipped; bank holidays not modelled). */
export function addBusinessDays(d, n) {
  const out = new Date(d);
  let left = n;
  while (left > 0) {
    out.setUTCDate(out.getUTCDate() + 1);
    if (!isWeekend(out)) left--;
  }
  return out;
}

function subBusinessDays(d, n) {
  const out = new Date(d);
  let left = n;
  while (left > 0) {
    out.setUTCDate(out.getUTCDate() - 1);
    if (!isWeekend(out)) left--;
  }
  return out;
}

function addMonths(d, n) {
  const out = new Date(d);
  out.setUTCMonth(out.getUTCMonth() + n);
  return out;
}

/** UK tax year label for a date, e.g. 2027-06-01 → "2027/28". */
export function taxYearLabel(d) {
  const y = d.getUTCFullYear();
  const startOfTY = new Date(Date.UTC(y, 3, 6)); // 6 April
  const startYear = d >= startOfTY ? y : y - 1;
  return `${startYear}/${String((startYear + 1) % 100).padStart(2, "0")}`;
}

// ── IRR ───────────────────────────────────────────────────────────────────────

/**
 * Annualised IRR of dated cashflows [{t: years, cf}], annual compounding,
 * solved by bisection to 1e-7 (spec §3.4). Returns a decimal (0.041 = 4.1%)
 * or null if the flows don't bracket a root.
 */
export function solveIRR(flows) {
  if (!flows.length) return null;
  const npv = r => flows.reduce((s, { t, cf }) => s + cf / Math.pow(1 + r, t), 0);
  let lo = -0.5, hi = 1.0;
  if (npv(lo) * npv(hi) > 0) return null;
  while (hi - lo > 1e-7) {
    const mid = (lo + hi) / 2;
    npv(mid) > 0 ? (lo = mid) : (hi = mid);
  }
  return (lo + hi) / 2;
}

// ── Per-gilt pricing at a settlement date ─────────────────────────────────────

const isIndexLinked = g => /index[- ]?linked|\bI\/?L\b/i.test(g.name);

/**
 * Coupon schedule + accrued for a gilt at `settlement`, with the ex-dividend
 * rule (§3.4): if settlement falls within 7 business days before the next
 * coupon date, the buyer forgoes that coupon and accrued goes negative
 * (rebate from settlement to the coupon date).
 */
export function priceGilt(gilt, cleanPx, settlement) {
  const coupons = futureCouponDates(gilt.mat, settlement);
  if (!coupons.length) return null;

  const next = coupons[0];
  const prev = addMonths(next, -6);
  const periodDays = (next - prev) / MS_DAY;

  const exDiv = settlement >= subBusinessDays(next, EX_DIV_BUSINESS_DAYS);
  const ai = exDiv
    ? -(gilt.c / 2) * ((next - settlement) / MS_DAY) / periodDays
    : calcAI(gilt.c, gilt.mat, settlement);

  const paidCoupons = exDiv ? coupons.slice(1) : coupons;
  return { coupons: paidCoupons, exDiv, ai, dirtyPx: cleanPx + ai };
}

// ── Ladder construction ───────────────────────────────────────────────────────

/**
 * Build a cashflow-matched gilt ladder (spec §3, "simple mode" sizing only).
 *
 * opts = {
 *   liabilities:   [{ date: 'YYYY-MM' | ISO | Date, amount: £ }]
 *   accountType:   'GIA' | 'ISA' | 'SIPP'      (ISA/SIPP ⇒ coupons untaxed)
 *   taxRate:       marginal income tax rate as a fraction (e.g. 0.45)
 *   preference:    'lowCoupon' | 'netYield'
 *   windowMonths:  a rung may use a gilt maturing up to this many months early
 *   settlement:    Date | ISO string
 *   universe:      gilt rows (MASTER shape: name, c, mat, px, sym)
 *   prices:        { [sym]: cleanPx } live overrides (falls back to row.px)
 *   incrementGBP:  platform nominal increment (default 100)
 *   cashNetRate:   net rate for the cash-alternative benchmark (default 0.03)
 * }
 */
export function buildLadder(opts) {
  const {
    liabilities,
    accountType = "GIA",
    taxRate = 0.45,
    preference = "lowCoupon",
    windowMonths = 12,
    settlement: settlementIn,
    universe,
    prices = {},
    incrementGBP = 100,
    cashNetRate = 0.03,
  } = opts;

  const settlement = toDate(settlementIn);
  const tEff = accountType === "GIA" ? taxRate : 0;
  const warnings = [];

  const indexLinked = universe.filter(isIndexLinked);
  if (indexLinked.length) {
    warnings.push(`${indexLinked.length} index-linked gilt(s) excluded from candidates.`);
  }
  const conv = universe
    .filter(g => !isIndexLinked(g))
    .filter(g => toDate(g.mat) > settlement);

  const rows = (liabilities || [])
    .map(l => ({ date: toDate(l.date), amount: Number(l.amount) || 0 }))
    .filter(l => l.amount > 0);

  const skipped = rows.filter(l => l.date <= settlement);
  if (skipped.length) {
    warnings.push(`${skipped.length} liability date(s) on or before settlement ignored.`);
  }

  const rungs = rows
    .filter(l => l.date > settlement)
    .sort((a, b) => a.date - b.date)
    .map(l => buildRung(l, conv, {
      preference, windowMonths, settlement, prices, incrementGBP, tEff,
    }));

  if (rungs.some(r => r.unfillable)) {
    warnings.push("Some liabilities fall beyond the longest available gilt and are excluded from totals.");
  }
  if (rungs.some(r => r.gapFilled)) {
    warnings.push("Some rungs needed a wider maturity window than requested (gap-filled).");
  }

  const filled = rungs.filter(r => !r.unfillable);

  // Portfolio IRR — IRR of the summed cashflow vector (§3.4)
  const allFlows = filled.flatMap(r => r.cashflows);
  const portfolioIRR = solveIRR(allFlows);

  // Weighted average life by nominal, to redemption
  const totNominal = filled.reduce((s, r) => s + r.nominal, 0);
  const wal = totNominal
    ? filled.reduce((s, r) => s + r.nominal * ((toDate(r.gilt.mat) - settlement) / YEAR), 0) / totNominal
    : null;

  // Surplus income: net coupon cash by UK tax year (§4.3)
  const surplusByTaxYear = {};
  for (const r of filled) {
    for (const c of r.couponFlows) {
      const key = taxYearLabel(c.date);
      surplusByTaxYear[key] = (surplusByTaxYear[key] || 0) + c.net;
    }
  }

  // Cash alternative (§3.5): lump sum today at cashNetRate meeting the same liabilities
  const cashAlternative = filled.reduce((s, r) =>
    s + r.liability / Math.pow(1 + cashNetRate, (r.liabilityDate - settlement) / YEAR), 0);

  const totals = {
    liability: filled.reduce((s, r) => s + r.liability, 0),
    nominal: totNominal,
    cost: filled.reduce((s, r) => s + r.cost, 0),
    netCoupons: filled.reduce((s, r) => s + r.netCoupons, 0),
    redemption: filled.reduce((s, r) => s + r.nominal, 0),
    portfolioIRR,
    weightedAvgLife: wal,
    cashAlternative,
    cashNetRate,
  };

  return { settlement, accountType, taxRateEffective: tEff, rungs, totals, surplusByTaxYear, warnings };
}

function buildRung(liab, universe, ctx) {
  const { preference, windowMonths, settlement, prices, incrementGBP, tEff } = ctx;

  // §3.1 candidate filtering: maturity in [liability − window, liability];
  // widen in 6-month steps up to 36 months if empty.
  let effWindow = windowMonths;
  let candidates = [];
  for (;;) {
    const lower = addMonths(liab.date, -effWindow);
    candidates = universe.filter(g => {
      const m = toDate(g.mat);
      return m >= lower && m <= liab.date;
    });
    if (candidates.length || effWindow >= 36) break;
    effWindow = Math.min(36, effWindow + 6);
  }

  const base = {
    liabilityDate: liab.date,
    liability: liab.amount,
    gapFilled: candidates.length > 0 && effWindow > windowMonths,
    effectiveWindowMonths: effWindow,
  };

  if (!candidates.length) {
    return { ...base, unfillable: true, gilt: null, nominal: 0, cost: 0, netCoupons: 0, netIRR: null, cashflows: [], couponFlows: [] };
  }

  // §3.2 selection — net-yield metric reuses the analyser's solveYTM verbatim
  const scored = candidates.map(g => {
    const cleanPx = prices[g.sym] ?? g.px;
    const p = priceGilt(g, cleanPx, settlement);
    const atYTM = solveYTM(g.c, g.mat, cleanPx, Math.max(0, p.ai), tEff, settlement) ?? -Infinity;
    return { g, cleanPx, p, atYTM };
  });
  scored.sort((a, b) =>
    preference === "netYield"
      ? (b.atYTM - a.atYTM) || (a.g.c - b.g.c)
      : (a.g.c - b.g.c) || (b.atYTM - a.atYTM)
  );
  const { g, cleanPx, p, atYTM } = scored[0];

  // §3.3 sizing: nominal = liability rounded up to the platform increment
  const nominal = Math.ceil(liab.amount / incrementGBP) * incrementGBP;

  // §3.4 pricing & cashflows
  const cost = nominal * p.dirtyPx / 100;
  const semiNet = nominal * (g.c / 2 / 100) * (1 - tEff);
  const matDate = toDate(g.mat);

  const couponFlows = p.coupons.map(date => ({ date, net: semiNet }));
  const cashflows = [{ t: 0, cf: -cost }];
  for (const c of couponFlows) {
    cashflows.push({ t: (c.date - settlement) / YEAR, cf: c.net });
  }
  cashflows.push({ t: (matDate - settlement) / YEAR, cf: nominal }); // redemption, untaxed

  return {
    ...base,
    unfillable: false,
    gilt: g,
    cleanPx,
    ai: p.ai,
    dirtyPx: p.dirtyPx,
    exDiv: p.exDiv,
    atYTM,
    nominal,
    cost,
    netCoupons: couponFlows.reduce((s, c) => s + c.net, 0),
    netIRR: solveIRR(cashflows),
    couponFlows,
    cashflows,
  };
}

// ── Quick-fill helper (§2): "£X per year for N years starting Y" ─────────────
export function quickFill(amount, years, startYearMonth) {
  const start = toDate(startYearMonth);
  return Array.from({ length: years }, (_, i) => ({
    date: `${start.getUTCFullYear() + i}-${String(start.getUTCMonth() + 1).padStart(2, "0")}`,
    amount,
  }));
}
