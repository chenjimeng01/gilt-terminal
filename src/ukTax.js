// UK income tax on gilt interest by band — pure functions, no React.
//
// The flat "income tax rate" slider treats every pound of coupon as taxed at
// one rate. In practice gilt interest is savings income and stacks on top of a
// person's other income, so part of it can fall in the personal allowance, the
// starting rate for savings, the personal savings allowance and the basic rate
// band before any reaches the higher rate. This module works that out from the
// person's other income.
//
// Rules modelled (ITA 2007 Part 2, England/Wales/NI bands; savings income uses
// these UK bands for Scottish taxpayers too):
//  - Personal allowance £12,570, set against non-savings income first; reduced
//    by £1 for every £2 of income above £100,000.
//  - Savings income is taxed after non-savings income, so it sits on top of it
//    in the bands: basic rate band £37,700 (to £50,270 of income with a full
//    allowance), higher rate to £125,140, additional rate above.
//  - Starting rate for savings: up to £5,000 at 0%, reduced by £1 for every £1
//    of non-savings income above the personal allowance (s.12).
//  - Personal savings allowance: £1,000 at 0% if no income is in the higher
//    band, £500 if some is, nil if any is in the additional band (s.12B).
//    Both nil-rate amounts use up band space.
//  - Savings rates 20/40/45% for 2026/27 and 22/42/47% from 6 April 2027
//    (Autumn Budget 2025). Allowances and thresholds are frozen to April 2031
//    and are held at those figures for later years too.
// Not modelled: dividends (taxed after savings, so gilt interest can push them
// into a higher band), Scottish rates on non-savings income, marriage
// allowance, pension/gift-aid band extensions, the High Income Child Benefit
// Charge and student loans.

export const TAX_PARAMS = {
  personalAllowance: 12570,
  taperStart: 100000,
  basicBand: 37700,        // taxable income taxed at the basic rate
  higherLimit: 125140,     // taxable income above this is additional rate
  startingRateBand: 5000,
  psaBasic: 1000,
  psaHigher: 500,
};

/** Income (with a full personal allowance) at which the higher rate starts: £50,270. */
export const HIGHER_RATE_THRESHOLD = TAX_PARAMS.personalAllowance + TAX_PARAMS.basicBand;

const NON_SAVINGS_RATES = [0.20, 0.40, 0.45];

/** [basic, higher, additional] savings rates for the tax year starting 6 April `tyStart`. */
export function savingsRates(tyStart) {
  return tyStart >= 2027 ? [0.22, 0.42, 0.47] : [0.20, 0.40, 0.45];
}

/** Calendar year in which the UK tax year containing `d` starts (6 April, UTC). */
export function taxYearStart(d) {
  const y = d.getUTCFullYear();
  return d >= new Date(Date.UTC(y, 3, 6)) ? y : y - 1;
}

export const taxYearName = y => `${y}/${String((y + 1) % 100).padStart(2, "0")}`;

const overlap = (from, to, lo, hi) => Math.max(0, Math.min(to, hi) - Math.max(from, lo));

/**
 * Income tax for one tax year on `nonSavings` income (salary, pension, rent,
 * profits — before tax) and `savings` income (interest).
 */
export function incomeTax(nonSavings, savings, tyStart) {
  const P = TAX_PARAMS;
  const ns = Math.max(0, Number(nonSavings) || 0);
  const sv = Math.max(0, Number(savings) || 0);

  const allowance = Math.max(0, P.personalAllowance - Math.max(0, (ns + sv - P.taperStart) / 2));
  const taxableNS = Math.max(0, ns - allowance);
  const taxableSV = Math.max(0, sv - Math.max(0, allowance - ns));
  const total = taxableNS + taxableSV;

  // Tax on the slice [from, to) of taxable income.
  const slice = (from, to, [basic, higher, additional]) =>
    basic * overlap(from, to, 0, P.basicBand) +
    higher * overlap(from, to, P.basicBand, P.higherLimit) +
    additional * Math.max(0, to - Math.max(from, P.higherLimit));

  const psa = total > P.higherLimit ? 0 : total > P.basicBand ? P.psaHigher : P.psaBasic;
  const startingRate = Math.max(0, P.startingRateBand - taxableNS);
  const nilRate = Math.min(taxableSV, startingRate + psa);

  const nonSavingsTax = slice(0, taxableNS, NON_SAVINGS_RATES);
  const savingsTax = slice(taxableNS + nilRate, total, savingsRates(tyStart));
  return { tax: nonSavingsTax + savingsTax, nonSavingsTax, savingsTax, allowance, taxableNS, taxableSV, nilRate, psa };
}

/**
 * Extra income tax caused by `interest` of gilt interest in one tax year, for
 * a person with profile { otherIncome, otherSavings } (both £ a year, before
 * tax). It is the tax with the gilt interest minus the tax without it, so it
 * includes knock-on effects: a smaller personal savings allowance once income
 * crosses into the higher rate, and personal allowance lost above £100,000.
 */
export function giltInterestTax(profile, interest, tyStart) {
  const ns = profile?.otherIncome, os = Math.max(0, Number(profile?.otherSavings) || 0);
  const g = Math.max(0, interest);
  return Math.max(0, incomeTax(ns, os + g, tyStart).tax - incomeTax(ns, os, tyStart).tax);
}

/**
 * How much gilt interest a year fits in each band for this profile:
 *   nil    — taxed at 0% (unused personal allowance, starting rate, PSA)
 *   basic  — the next slice, taxed at the basic rate, up to the £50,270
 *            higher-rate threshold
 * Anything beyond nil + basic is taxed at the higher rate or above. The
 * amounts depend only on thresholds, which are the same in every year modelled.
 */
export function bandHeadroom(profile) {
  const ns = Math.max(0, Number(profile?.otherIncome) || 0);
  const os = Math.max(0, Number(profile?.otherSavings) || 0);
  // Largest interest with no extra tax; tax is non-decreasing in interest.
  let lo = 0, hi = TAX_PARAMS.personalAllowance + TAX_PARAMS.startingRateBand + TAX_PARAMS.psaBasic + 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    giltInterestTax(profile, mid, 2026) > 1e-9 ? (hi = mid) : (lo = mid);
  }
  const nil = Math.round(lo * 100) / 100;
  const toThreshold = Math.max(0, HIGHER_RATE_THRESHOLD - ns - os);
  return { nil, basic: Math.max(0, toThreshold - nil), toThreshold };
}

/**
 * Tax a set of dated flows [{ date, taxable }] by band: taxable interest is
 * summed per tax year, the year's tax found with giltInterestTax, and spread
 * evenly over that year's interest. Other income is assumed the same every year.
 *
 * Returns { byYear: [{ year, label, interest, tax, rate }], interest, tax,
 * rateAt } — rateAt(date) is the year's average rate, usable wherever the
 * maths takes a tax rate (afterTaxCouponFlows, solveYTM, buildLadder).
 */
export function bandSchedule(flows, profile) {
  const sums = new Map();
  for (const f of flows) {
    const y = taxYearStart(f.date);
    sums.set(y, (sums.get(y) || 0) + (f.taxable || 0));
  }
  const byYear = [...sums].sort((a, b) => a[0] - b[0]).map(([year, interest]) => {
    const tax = giltInterestTax(profile, interest, year);
    return { year, label: taxYearName(year), interest, tax, rate: interest > 0 ? tax / interest : 0 };
  });
  const rates = new Map(byYear.map(y => [y.year, y.rate]));
  return {
    byYear,
    interest: byYear.reduce((s, y) => s + y.interest, 0),
    tax: byYear.reduce((s, y) => s + y.tax, 0),
    rateAt: d => rates.get(taxYearStart(d)) ?? 0,
  };
}

/**
 * Gross rate (%, simple annual) a fully-taxable deposit of `amount` would need
 * so that, with its interest taxed by the same bands, it nets `netYieldPct`.
 * Returns null if no rate up to 100% does.
 */
export function depositEquivalent(netYieldPct, amount, profile, tyStart) {
  if (netYieldPct == null || !(amount > 0)) return null;
  const net = r => r - giltInterestTax(profile, amount * r, tyStart) / amount;
  const target = netYieldPct / 100;
  if (target <= 0) return netYieldPct;
  let lo = 0, hi = 1;
  if (net(hi) < target) return null;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    net(mid) < target ? (lo = mid) : (hi = mid);
  }
  return ((lo + hi) / 2) * 100;
}
