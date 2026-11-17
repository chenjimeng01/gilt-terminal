// Analyser row maths (moved out of GiltTerminal.jsx so it can be tested).

import { settlementTerms, solveYTM, afterTaxCouponFlows } from "./giltMath.js";
import { bandSchedule, bandHeadroom, depositEquivalent, taxYearStart } from "./ukTax.js";
import { MASTER } from "./giltUniverse.js";

const YEAR = 365.25 * 86400000;

/**
 * Deposit-equivalent yield: the gross yield a fully-taxable instrument would
 * need to offer to match this gilt's after-tax return. atYTM / (1 − taxRate).
 */
export function calcGEY(atYTM, taxRate) {
  if (taxRate === 0) return atYTM;
  return atYTM / (1 - taxRate);
}

function getTenor(matStr, settlement) {
  const y = (new Date(matStr) - settlement) / YEAR;
  return y <= 5 ? "short" : y <= 15 ? "medium" : "long";
}

/**
 * One row per gilt, after-tax yields at the right settlement date.
 *
 * Each gilt's price comes from, in order:
 *  - manual[sym]  a one-off price the user typed (manualPrices.js), priced at
 *                 its own settlement (T+1 from when it was entered). The file's
 *                 DMO dirty price is ignored for it.
 *  - prices[sym]  the DMO file's clean price, priced at `settlement` (T+1 after
 *                 the file's asOf), using liveDirty[sym] when present.
 *  - g.px         the snapshot price, priced at `settlement` (T+1 after the
 *                 snapshot date).
 * `taxProfile` = { otherIncome, otherSavings, amount } switches coupon tax from
 * the flat `taxRate` to UK bands (ukTax.js): `amount` £ is put into each gilt
 * on its own, its taxable interest is summed per tax year and taxed on top of
 * the person's other income. Each row then carries `bands`:
 *   nominal, annualInterest (a full year's coupons), interest / tax (whole
 *   life), effRate (tax ÷ taxable interest), byYear, rateAt, and nilCost /
 *   basicCost — what a holding of this gilt costs when a full year's coupons
 *   exactly use the 0% headroom / reach the £50,270 higher-rate threshold.
 *
 * Accrued interest and gross yield are always recomputed (MASTER's stored
 * ai/gy are not used). A null yield means no yield in range reprices the gilt.
 */
export function analyseGilts({
  universe = MASTER, prices = {}, isLive, taxRate, settlement,
  liveDirty = {}, manual = {}, today = new Date(), taxProfile = null,
}) {
  const amount = Number(taxProfile?.amount) || 0;
  const banded = !!taxProfile && amount > 0;
  const head = banded ? bandHeadroom(taxProfile) : null;
  return universe
    .filter(g => new Date(g.mat) > today)
    .map(g => {
      const m = manual[g.sym]?.ok ? manual[g.sym] : null;
      const settle = m ? new Date(m.settlement + "T00:00:00Z") : settlement;
      const terms = settlementTerms(g.c, g.mat, settle);
      if (!terms) return null;

      const cp = m ? m.clean : (prices[g.sym] ?? g.px);
      const dmoDirty = !m && isLive ? liveDirty[g.sym] : undefined;
      // Accrued at settlement, negative inside the ex-dividend window (the
      // buyer forgoes the next coupon; solveYTM then excludes it).
      const ai = Number.isFinite(dmoDirty) ? dmoDirty - cp : terms.ai;

      const grossYTM = solveYTM(g.c, g.mat, cp, ai, 0, settle);
      let at, gey, bands = null;
      if (banded) {
        const dirty = cp + ai;
        const nominal = amount / dirty * 100;
        const sched = bandSchedule(
          afterTaxCouponFlows(g, settle, nominal, () => 0, { terms: { ...terms, ai } }), taxProfile);
        at = solveYTM(g.c, g.mat, cp, ai, sched.rateAt, settle);
        const midLife = new Date((+settle + +new Date(g.mat)) / 2);
        gey = depositEquivalent(at, amount, taxProfile, taxYearStart(midLife));
        const costFor = interest => (g.c > 0 ? interest / (g.c / 100) * dirty / 100 : null);
        bands = {
          nominal, annualInterest: nominal * g.c / 100,
          interest: sched.interest, tax: sched.tax,
          effRate: sched.interest > 0 ? sched.tax / sched.interest : 0,
          byYear: sched.byYear, rateAt: sched.rateAt,
          nilCost: costFor(head.nil), basicCost: costFor(head.toThreshold),
        };
      } else {
        at = taxRate === 0 ? grossYTM : solveYTM(g.c, g.mat, cp, ai, taxRate, settle);
        gey = at != null ? calcGEY(at, taxRate) : null;
      }
      const drag = at != null && grossYTM != null ? grossYTM - at : null;

      return {
        ...g, cp, ai, exDiv: terms.exDiv, grossYTM, at, gey, drag, bands,
        yrs: (new Date(g.mat) - settle) / YEAR,
        tenor: getTenor(g.mat, settle),
        couponType: g.c <= 2 ? "low" : "high",
        dPx: cp - g.px,
        settlement: settle,
        priceSource: m ? "manual" : isLive && prices[g.sym] != null ? "file" : "snapshot",
        manual: m,
      };
    })
    .filter(Boolean);
}
