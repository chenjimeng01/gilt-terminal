// Ladder Builder engine — pure functions, no React, no fetching.
// Runs identically in the browser (LadderView.jsx) and Node (ladder.test.mjs).
// Shares the analyser's maths (giltMath.js): settlement terms (accrued
// interest, ex-dividend), after-tax coupon flows (accrued income scheme) and
// the after-tax-YTM selection metric, so the selection metric and the rung IRR
// use the same cash flows. Redemption at par is untaxed.

import {
  settlementTerms, afterTaxCouponFlows, solveYTM, addMonthsUTC, MS_DAY,
  addBusinessDays,
} from "./giltMath.js";

export { addBusinessDays };

const YEAR = 365.25 * MS_DAY;

// ── Date helpers ──────────────────────────────────────────────────────────────

export function toDate(d) {
  if (d instanceof Date) return d;
  if (/^\d{4}-\d{2}$/.test(d)) return new Date(d + "-01"); // month granularity → 1st
  return new Date(d);
}

const addMonths = addMonthsUTC;

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

export const isIndexLinked = g => /index[- ]?linked|\bI\/?L\b/i.test(g.name);

/**
 * Coupon schedule + accrued for a gilt at `settlement`, with the ex-dividend
 * rule (§3.4) — see settlementTerms in giltMath.js, which the analyser uses too.
 *
 * `liveDirty`: the DMO dirty price for this gilt, if it is for this exact
 * settlement date. It is then used as-is and accrued = dirty − clean.
 */
export function priceGilt(gilt, cleanPx, settlement, liveDirty = null) {
  let terms = settlementTerms(gilt.c, gilt.mat, settlement);
  if (!terms) return null;
  if (Number.isFinite(liveDirty)) terms = { ...terms, ai: liveDirty - cleanPx };
  return {
    coupons: terms.coupons, exDiv: terms.exDiv, ai: terms.ai, dirtyPx: cleanPx + terms.ai,
    terms, dirtyFromDMO: Number.isFinite(liveDirty),
  };
}

// ── Ladder construction ───────────────────────────────────────────────────────

/**
 * Build a cashflow-matched gilt ladder (spec §3).
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
 *   cashNetRate:   net rate for the cash benchmark and for cash held between
 *                  an inflow and the liability it serves (default 0.03)
 *   inflation:     annual rate; liability amounts are in today's money and
 *                  grow at this rate from settlement to their date (default 0)
 *   sizing:        'simple'       nominal = liability, rounded up (default)
 *                  'couponOffset' size from the longest rung back, netting off
 *                                 coupons (and early redemptions) carried to
 *                                 each liability at cashNetRate
 *   dirtyPrices:   { [sym]: dirtyPx } live DMO dirty prices (optional), used
 *                  only when dirtySettlement equals the ladder's settlement
 *   dirtySettlement: 'YYYY-MM-DD' the dirty prices are for
 *   ais:           apply the accrued income scheme to coupon tax (default true;
 *                  false if total nominal holdings never exceed £5,000)
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
    inflation = 0,
    sizing = "simple",
    ais = true,
    dirtyPrices = {},
    dirtySettlement = null,
  } = opts;

  const settlement = toDate(settlementIn);
  const dirtyFor = dirtySettlement && dirtySettlement === settlement.toISOString().slice(0, 10)
    ? dirtyPrices : {};
  const tEff = accountType === "GIA" ? taxRate : 0;
  const warnings = [];
  const grow = (from, to) => Math.pow(1 + cashNetRate, (to - from) / YEAR);

  const indexLinked = universe.filter(isIndexLinked);
  if (indexLinked.length) {
    warnings.push(`${indexLinked.length} index-linked gilt(s) excluded from candidates.`);
  }
  const conv = universe
    .filter(g => !isIndexLinked(g))
    .filter(g => toDate(g.mat) > settlement);

  const rows = (liabilities || [])
    .map(l => ({ date: toDate(l.date), amountToday: Number(l.amount) || 0 }))
    .filter(l => l.amountToday > 0);

  const skipped = rows.filter(l => l.date <= settlement);
  if (skipped.length) {
    warnings.push(`${skipped.length} liability date(s) on or before settlement ignored.`);
  }

  // P2-1: amounts are in today's money; grow each to its date.
  const ctx = { preference, windowMonths, settlement, prices, tEff, ais, dirtyFor, cashNetRate };
  const selections = rows
    .filter(l => l.date > settlement)
    .sort((a, b) => a.date - b.date)
    .map(l => ({
      ...l,
      amount: l.amountToday * Math.pow(1 + (Number(inflation) || 0), (l.date - settlement) / YEAR),
    }))
    .map(l => selectRung(l, conv, ctx));

  // §3.3 sizing
  const filledSel = selections.filter(x => !x.unfillable);
  const nominals = new Map();
  if (sizing === "couponOffset") {
    // Each inflow (after-tax coupon, redemption) is assigned to the first
    // liability on or after its date and carried there at cashNetRate. Size
    // from the longest rung back: rung j covers what the longer, already-sized
    // rungs' inflows assigned to liability j don't. Inflows are linear in
    // nominal, so per-£1-nominal flows give the rung's own coverage.
    // Any surplus from rounding up is not carried forward (conservative).
    const L = filledSel.map(x => x.liabilityDate);
    const assign = d => L.findIndex(l => l >= d);
    const unit = filledSel.map(x => unitInflows(x, ctx).map(f => {
      const j = assign(f.date);
      return { j, value: f.cf * grow(f.date, L[j]) };
    }));
    const credit = L.map(() => 0);
    for (let j = filledSel.length - 1; j >= 0; j--) {
      const own = unit[j].filter(f => f.j === j).reduce((s, f) => s + f.value, 0);
      const need = filledSel[j].liability - credit[j];
      const nominal = need <= 0 ? 0 : Math.ceil(need / own / incrementGBP) * incrementGBP;
      nominals.set(filledSel[j], nominal);
      for (const f of unit[j]) if (f.j < j) credit[f.j] += nominal * f.value;
    }
  } else {
    for (const x of filledSel) nominals.set(x, Math.ceil(x.liability / incrementGBP) * incrementGBP);
  }

  const rungs = selections.map(x => x.unfillable ? x : finishRung(x, nominals.get(x), ctx));

  if (rungs.some(r => r.unfillable)) {
    warnings.push("Some liabilities fall beyond the longest available gilt and are excluded from totals.");
  }
  if (rungs.some(r => r.gapFilled)) {
    warnings.push("Some rungs needed a wider maturity window than requested (gap-filled).");
  }

  const unsolved = [...new Set(rungs.flatMap(r => r.unsolvedCandidates || []))];
  if (unsolved.length) {
    warnings.push(`No yield between −50% and 100% reprices ${unsolved.join(", ")} — ranked last; check the price.`);
  }
  if (rungs.some(r => !r.unfillable && r.nominal > 0 && r.netIRR == null)) {
    warnings.push("Some rungs have no IRR in range (shown as —).");
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

  // Net coupon income by UK tax year (§4.3)
  const surplusByTaxYear = {};
  for (const r of filled) {
    for (const c of r.couponFlows) {
      const key = taxYearLabel(c.date);
      surplusByTaxYear[key] = (surplusByTaxYear[key] || 0) + c.net;
    }
  }

  // Cash benchmark (§3.5), at cashNetRate, annual compounding, actual/365.25:
  //  - cashAlternative: lump sum today that meets the same liabilities.
  //  - inflowsPV: every after-tax inflow the ladder pays (coupons and
  //    redemptions, including surplus and early redemptions), valued at the
  //    same rate — i.e. as if each were put on deposit until needed.
  //  - cashAdvantage = inflowsPV − cost: how much better the ladder is than
  //    cash (> 0 exactly when the ladder's IRR beats cashNetRate).
  //  - ladderNetCost = cost − value of the surplus over the liabilities
  //    = cashAlternative − cashAdvantage, comparable with cashAlternative.
  // The old figure, cashAlternative − cost, ignored the ladder's coupons and
  // any surplus redemption, so it understated the ladder (e.g. said "£14k
  // more than cash" for a ladder yielding 4.9% against 3% cash).
  const discount = t => Math.pow(1 + cashNetRate, -t);
  const cashAlternative = filled.reduce((s, r) =>
    s + r.liability * discount((r.liabilityDate - settlement) / YEAR), 0);
  const cost = filled.reduce((s, r) => s + r.cost, 0);
  const inflowsPV = allFlows.filter(f => f.t > 0).reduce((s, f) => s + f.cf * discount(f.t), 0);
  const cashAdvantage = inflowsPV - cost;

  const totals = {
    liability: filled.reduce((s, r) => s + r.liability, 0),
    liabilityToday: filled.reduce((s, r) => s + r.liabilityToday, 0),
    nominal: totNominal,
    cost,
    netCoupons: filled.reduce((s, r) => s + r.netCoupons, 0),
    redemption: totNominal,
    idleInterest: filled.reduce((s, r) => s + r.idleInterest, 0),
    portfolioIRR,
    weightedAvgLife: wal,
    cashAlternative,
    inflowsPV,
    cashAdvantage,
    ladderNetCost: cashAlternative - cashAdvantage,
    cashNetRate,
    inflation: Number(inflation) || 0,
    sizing,
  };

  return { settlement, accountType, taxRateEffective: tEff, rungs, totals, surplusByTaxYear, warnings };
}

/** §3.1–3.2: candidate window and gilt selection for one liability. */
function selectRung(liab, universe, ctx) {
  const { preference, windowMonths, settlement, prices, tEff, ais, dirtyFor } = ctx;

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
    liabilityToday: liab.amountToday,
    gapFilled: candidates.length > 0 && effWindow > windowMonths,
    effectiveWindowMonths: effWindow,
  };

  if (!candidates.length) {
    return { ...base, unfillable: true, gilt: null, nominal: 0, cost: 0, netCoupons: 0, netIRR: null,
      idleInterest: 0, cashflows: [], couponFlows: [] };
  }

  // §3.2 selection — net-yield metric is the analyser's solveYTM, fed the real
  // accrued (negative when ex-div), so the forgone coupon is excluded.
  const scored = candidates.map(g => {
    const cleanPx = prices[g.sym] ?? g.px;
    const p = priceGilt(g, cleanPx, settlement, dirtyFor[g.sym]);
    const y = solveYTM(g.c, g.mat, cleanPx, p.ai, tEff, settlement, { ais });
    return { g, cleanPx, p, atYTM: y ?? -Infinity, solved: y != null };
  });
  const unsolvedCandidates = scored.filter(x => !x.solved).map(x => x.g.sym);
  scored.sort((a, b) =>
    preference === "netYield"
      ? (b.atYTM - a.atYTM) || (a.g.c - b.g.c)
      : (a.g.c - b.g.c) || (b.atYTM - a.atYTM)
  );
  const { g, cleanPx, p, atYTM } = scored[0];
  return {
    ...base, unsolvedCandidates, unfillable: false,
    gilt: g, cleanPx, p, atYTM: Number.isFinite(atYTM) ? atYTM : null,
  };
}

/** After-tax inflows per £1 nominal: coupons (same model as selection) + redemption. */
function unitInflows(sel, ctx) {
  const { settlement, tEff, ais } = ctx;
  const flows = afterTaxCouponFlows(sel.gilt, settlement, 1, tEff, { ais, terms: sel.p.terms })
    .map(c => ({ date: c.date, cf: c.net }));
  flows.push({ date: toDate(sel.gilt.mat), cf: 1 }); // redemption at par, untaxed
  return flows;
}

/** §3.4 pricing and cash flows for a selected rung at a given nominal. */
function finishRung(sel, nominal, ctx) {
  const { settlement, tEff, ais, cashNetRate } = ctx;
  const { p, gilt: g } = sel;
  const cost = nominal * p.dirtyPx / 100;
  const matDate = toDate(g.mat);

  // Same after-tax coupon model as the selection metric (afterTaxCouponFlows).
  const couponFlows = nominal > 0
    ? afterTaxCouponFlows(g, settlement, nominal, tEff, { ais, terms: p.terms })
    : [];
  const cashflows = nominal > 0 ? [{ t: 0, cf: -cost }] : [];
  for (const c of couponFlows) {
    cashflows.push({ t: (c.date - settlement) / YEAR, cf: c.net });
  }
  if (nominal > 0) cashflows.push({ t: (matDate - settlement) / YEAR, cf: nominal }); // redemption, untaxed

  // P2-3: redemption cash idles from maturity to the liability date.
  const idleYears = Math.max(0, (sel.liabilityDate - matDate) / YEAR);

  const { p: _p, ...rest } = sel;
  return {
    ...rest,
    ai: p.ai,
    dirtyPx: p.dirtyPx,
    exDiv: p.exDiv,
    dirtyFromDMO: p.dirtyFromDMO,
    nominal,
    cost,
    netCoupons: couponFlows.reduce((s, c) => s + c.net, 0),
    netIRR: nominal > 0 ? solveIRR(cashflows) : null,
    idleYears,
    idleMonths: Math.round(idleYears * 12),
    idleInterest: nominal * (Math.pow(1 + cashNetRate, idleYears) - 1),
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
