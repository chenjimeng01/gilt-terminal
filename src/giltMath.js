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
    d.setMonth(d.getMonth() - 6);
  }
  return dates; // chronological, all strictly after `now`
}

/**
 * Accrued interest — Actual/Actual day count (UK gilt convention).
 * Replaces the old fixed-182.5-day denominator.
 */
export function calcAI(coupon, matStr, now = NOW) {
  const mat = new Date(matStr);
  const mo = mat.getMonth();
  const dy = mat.getDate();
  const yr = now.getFullYear();

  // Candidate last-coupon dates
  const cands = [
    new Date(yr,     mo,     dy),
    new Date(yr,     mo - 6, dy),
    new Date(yr - 1, mo,     dy),
    new Date(yr - 1, mo - 6, dy),
  ].filter(d => d <= now);

  const prevCoupon = cands.reduce((a, b) => (b > a ? b : a));

  // Next coupon = prevCoupon + 6 months
  const nextCoupon = new Date(prevCoupon);
  nextCoupon.setMonth(nextCoupon.getMonth() + 6);

  // Actual/Actual: days elapsed / actual days in period
  const daysElapsed  = (now - prevCoupon)  / 86400000;
  const periodLength = (nextCoupon - prevCoupon) / 86400000;

  return (coupon / 2) * (daysElapsed / periodLength);
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
 * maturity has passed or too close.
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

  // Bisection — solve for r such that PV(r) = dirty price
  let lo = 0.0001, hi = 0.50;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    pv(mid) > dp ? (lo = mid) : (hi = mid);
  }

  return ((lo + hi) / 2) * 100; // annualised %, e.g. 4.16
}
