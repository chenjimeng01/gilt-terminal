// Shared gilt maths — moved verbatim from GiltTerminal.jsx so the ladder engine
// and the Node golden tests run the exact code the page uses. Each function takes
// an optional trailing `now` (defaults to module-load time, matching the old
// module-level NOW constant).

const NOW = new Date();
export const MS_DAY = 86400000;

// All date arithmetic is in UTC. Dates are parsed from "YYYY-MM-DD" strings,
// which JavaScript treats as UTC midnight; mixing in local-time getters and
// setters shifted coupon dates by an hour across BST and moved accrued
// interest in the 4th decimal place depending on the viewer's time zone.

/**
 * Add `n` calendar months in UTC, clamping to the last day of the target
 * month (31 Aug − 6 months = 28/29 Feb, not 3 Mar).
 */
export function addMonthsUTC(d, n) {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay)));
}

/**
 * Coupon date k half-years before maturity. Always computed from maturity
 * (never by stepping from the previous coupon) so a month-end clamp doesn't
 * stick: 31 Aug → 28 Feb → 31 Aug, not → 28 Aug.
 */
function couponDate(mat, k) {
  return addMonthsUTC(mat, -6 * k);
}

/**
 * Build the ordered list of all future coupon dates for a gilt.
 * Walks backwards from maturity in 6-month steps until we pass `now`,
 * then returns the array in chronological order.
 */
export function futureCouponDates(matStr, now = NOW) {
  return couponSchedule(matStr, now).dates;
}

/**
 * Coupon schedule at `now`: `dates` = all coupon dates strictly after `now`
 * (chronological), `prev` = the scheduled coupon date on or before `now`
 * (start of the current coupon period). `prev` is null if maturity has passed.
 */
export function couponSchedule(matStr, now = NOW) {
  const mat = new Date(matStr);
  const dates = [];
  let k = 0;
  let d = mat;
  while (d > now) {
    dates.unshift(d);
    d = couponDate(mat, ++k);
  }
  return { dates, prev: dates.length ? d : null };
}

/**
 * Accrued interest per £100 nominal — Actual/Actual (UK gilt convention),
 * cum-dividend.
 *
 * Derived from the coupon schedule: the next coupon is the first scheduled
 * date strictly after `now`, the previous one is six months before it. (The
 * old version guessed candidate previous-coupon dates from the maturity month
 * and missed this year's second coupon for Jan–Jun maturities, overstating AI
 * by 2–4× for half the year.)
 */
export function calcAI(coupon, matStr, now = NOW) {
  const { dates, prev } = couponSchedule(matStr, now);
  if (!dates.length) return 0;
  const next = dates[0];
  return (coupon / 2) * ((now - prev) / MS_DAY) / ((next - prev) / MS_DAY);
}

// ── Business days (weekends only; UK bank holidays not yet modelled) ─────────

export const EX_DIV_BUSINESS_DAYS = 7;

function isWeekend(d) {
  const wd = d.getUTCDay();
  return wd === 0 || wd === 6;
}

/** `n` business days after `d` (weekends skipped). */
export function addBusinessDays(d, n) {
  const out = new Date(d);
  let left = n;
  while (left > 0) {
    out.setUTCDate(out.getUTCDate() + 1);
    if (!isWeekend(out)) left--;
  }
  return out;
}

/** `n` business days before `d` (weekends skipped). */
export function subBusinessDays(d, n) {
  const out = new Date(d);
  let left = n;
  while (left > 0) {
    out.setUTCDate(out.getUTCDate() - 1);
    if (!isWeekend(out)) left--;
  }
  return out;
}

// ── Settlement terms (shared by analyser and ladder) ─────────────────────────

/**
 * What a buyer settling on `settlement` pays and receives, per £100 nominal.
 *
 * Ex-dividend rule: if settlement falls on or after the date 7 business days
 * before the next coupon, the buyer forgoes that coupon (it goes to the
 * holder of record) and accrued interest is negative — a rebate for the days
 * from settlement to the coupon date.
 *
 * Returns null if the gilt has matured, else
 *   { prev, next, dates, coupons, exDiv, ai }
 * where `dates` is every scheduled coupon after settlement and `coupons` the
 * ones the buyer actually receives.
 */
export function settlementTerms(coupon, matStr, settlement = NOW) {
  const { dates, prev } = couponSchedule(matStr, settlement);
  if (!dates.length) return null;
  const next = dates[0];
  const periodDays = (next - prev) / MS_DAY;
  const exDiv = settlement >= subBusinessDays(next, EX_DIV_BUSINESS_DAYS);
  const ai = exDiv
    ? -(coupon / 2) * ((next - settlement) / MS_DAY) / periodDays
    : (coupon / 2) * ((settlement - prev) / MS_DAY) / periodDays;
  return { prev, next, dates, coupons: exDiv ? dates.slice(1) : dates, exDiv, ai };
}

/**
 * After-tax coupon cash flows for `nominal` £ of a gilt bought at
 * `settlement`, taxed at `taxRate`. Redemption is not included (it is
 * CGT-exempt, TCGA 1992 s.115, and the caller adds it).
 *
 * Accrued income scheme (ITA 2007 Part 12; HMRC SAIM4020, SAIM4140–4160):
 *  - Cum-div purchase: the buyer paid accrued interest in the dirty price and
 *    gets relief for it against the next coupon, so the first coupon is taxed
 *    only on (c/2 − AI). (ITA 2007 s.632/s.633; SAIM4140.)
 *  - Ex-div purchase: the buyer does not receive the next coupon but is
 *    treated as receiving the rebate interest (|AI|, settlement → coupon
 *    date) and is taxed on it. (ITA 2007 s.633; SAIM4150, SAIM4160 example;
 *    CG54506: "the transferee is treated as though they received a sum
 *    equal to the rebate amount".) Modelled as a tax payment on the forgone
 *    coupon date, the end of the interest period in which it is charged.
 *  - opts.ais = false: the scheme does not apply (e.g. total nominal holdings
 *    never above £5,000 in the tax year or the previous one, ITA 2007 s.639).
 *    Every coupon received is then taxed in full and the rebate is untaxed.
 *
 * Returns [{ date, gross, tax, net, rebate? }] in date order.
 * `opts.terms` may pass a precomputed settlementTerms result (its `ai` is used).
 */
export function afterTaxCouponFlows(gilt, settlement, nominal, taxRate, opts = {}) {
  const ais = opts.ais ?? true;
  const terms = opts.terms ?? settlementTerms(gilt.c, gilt.mat, settlement);
  if (!terms) return [];
  const semi = nominal * gilt.c / 200;
  const aiAmt = nominal * terms.ai / 100;

  const flows = terms.coupons.map((date, i) => {
    const taxable = ais && !terms.exDiv && i === 0 ? Math.max(0, semi - aiAmt) : semi;
    const tax = taxable * taxRate;
    return { date, gross: semi, tax, net: semi - tax };
  });
  if (ais && terms.exDiv && taxRate > 0) {
    const tax = -aiAmt * taxRate; // aiAmt < 0 when ex-div
    flows.unshift({ date: terms.next, gross: 0, tax, net: -tax, rebate: true });
  }
  return flows;
}

/**
 * Solve after-tax (or gross, when taxRate=0) yield to maturity, per £100
 * nominal, from the cash flows the buyer actually receives:
 *
 *  - Ex-div settlement: the forgone coupon is excluded and accrued is negative.
 *  - Coupon tax per afterTaxCouponFlows (accrued income scheme on the first
 *    coupon unless opts.ais === false).
 *  - Redemption at par, CGT-exempt.
 *
 * `ai` is the accrued interest actually paid (negative when ex-div). Pass
 * null to derive it from the coupon schedule at `now`.
 *
 * Returns annualised yield as a percentage (e.g. 4.16 for 4.16%), or null if
 * maturity has passed or no yield in [−50%, 100%] reprices the gilt.
 */
export function solveYTM(coupon, matStr, cleanPx, ai, taxRate, now = NOW, opts = {}) {
  const base = settlementTerms(coupon, matStr, now);
  if (!base) return null;
  const terms = ai == null ? base : { ...base, ai };

  const dp = cleanPx + terms.ai; // dirty price — what you actually pay
  const mat = new Date(matStr);
  const year = 365.25 * MS_DAY;

  const cashFlows = afterTaxCouponFlows({ c: coupon, mat: matStr }, now, 100, taxRate, { ais: opts.ais, terms })
    .map(f => ({ t: (f.date - now) / year, cf: f.net }));
  cashFlows.push({ t: (mat - now) / year, cf: 100 }); // redemption, untaxed

  // PV using semi-annual compounding (UK gilt convention):
  // PV = Σ CF_i / (1 + r/2)^(2·t_i)
  const pv = r => cashFlows.reduce((sum, { t, cf }) =>
    sum + cf / Math.pow(1 + r / 2, 2 * t), 0);

  // Bisection on [−50%, 100%]. If PV − price has the same sign at both ends
  // there is no root in range: return null rather than a boundary value (the
  // old [0.01%, 50%] bracket silently reported 0.01% for negative yields).
  let lo = -0.5, hi = 1.0;
  const fLo = pv(lo) - dp, fHi = pv(hi) - dp;
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi) || fLo * fHi > 0) return null;
  while (hi - lo > 1e-10) {
    const mid = (lo + hi) / 2;
    pv(mid) > dp ? (lo = mid) : (hi = mid);
  }

  return ((lo + hi) / 2) * 100; // annualised %, e.g. 4.16
}
