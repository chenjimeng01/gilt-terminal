// Shared gilt maths — moved verbatim from GiltTerminal.jsx so the ladder engine
// and the Node golden tests run the exact code the page uses. Each function takes
// an optional trailing `now` (defaults to module-load time, matching the old
// module-level NOW constant).

const NOW = new Date();

/**
 * Build the ordered list of all future coupon dates for a gilt.
 * Walks backwards from maturity in 6-month steps until we pass `now`,
 * then returns the array in chronological order.
 */
export function futureCouponDates(matStr, now = NOW) {
  const mat = new Date(matStr);
  const dates = [];
  let d = new Date(mat);
  while (d > now) {
    dates.unshift(new Date(d));
    d.setUTCMonth(d.getUTCMonth() - 6);
  }
  return dates; // chronological, all strictly after `now`
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
  const dates = futureCouponDates(matStr, now);
  if (!dates.length) return 0;
  const next = dates[0];
  const prev = new Date(next);
  prev.setUTCMonth(prev.getUTCMonth() - 6);
  return (coupon / 2) * ((now - prev) / 86400000) / ((next - prev) / 86400000);
}

/**
 * Solve after-tax (or gross, when taxRate=0) YTM using exact coupon schedule.
 *
 * Fixes vs old version:
 *  1. Uses real future coupon dates — no more rounding error on coupon count.
 *  2. Each cash flow discounted by its actual fractional year — correct stub period.
 *  3. First coupon: only the portion accruing AFTER purchase is taxable income;
 *     the accrued interest paid is a return of capital and is not taxed.
 *  4. Redemption gain (£100 - cleanPx) is CGT-exempt — unchanged, still correct.
 *
 * Returns annualised yield as a percentage (e.g. 4.16 for 4.16%), or null if
 * maturity has passed or no yield in [−50%, 100%] reprices the gilt.
 */
export function solveYTM(coupon, matStr, cleanPx, ai, taxRate, now = NOW) {
  const mat = new Date(matStr);
  if (mat <= now) return null;

  const dates = futureCouponDates(matStr, now);
  if (dates.length === 0) return null;

  const dp = cleanPx + ai; // dirty price — what you actually pay
  const semiCoupon = coupon / 2; // gross semi-annual coupon per £100 nominal

  // Build after-tax cash flows with exact timing
  const cashFlows = dates.map((dt, i) => {
    const isFirst = i === 0;
    const isLast  = i === dates.length - 1;

    // First coupon: the accrued interest portion (aiPaid) is a return of capital
    // (you paid it in the dirty price), so only (semiCoupon - ai) is new income.
    // Subsequent coupons: fully taxable income.
    const newIncome = isFirst ? Math.max(0, semiCoupon - ai) : semiCoupon;
    const returnOfCapital = isFirst ? Math.min(ai, semiCoupon) : 0;

    const afterTaxCouponCF = newIncome * (1 - taxRate) + returnOfCapital;

    // Redemption at par on final date — CGT-exempt, no tax applied
    const redemption = isLast ? 100 : 0;

    return {
      t: (dt - now) / (365.25 * 86400000), // fractional years
      cf: afterTaxCouponCF + redemption,
    };
  });

  // PV function using semi-annual compounding (UK gilt convention):
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
