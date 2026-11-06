// Analyser row maths (moved out of GiltTerminal.jsx so it can be tested).

import { settlementTerms, solveYTM } from "./giltMath.js";
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
 * Accrued interest and gross yield are always recomputed (MASTER's stored
 * ai/gy are not used). A null yield means no yield in range reprices the gilt.
 */
export function analyseGilts({
  universe = MASTER, prices = {}, isLive, taxRate, settlement,
  liveDirty = {}, manual = {}, today = new Date(),
}) {
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
      const at = taxRate === 0 ? grossYTM : solveYTM(g.c, g.mat, cp, ai, taxRate, settle);
      const gey = at != null ? calcGEY(at, taxRate) : null;
      const drag = at != null && grossYTM != null ? grossYTM - at : null;

      return {
        ...g, cp, ai, exDiv: terms.exDiv, grossYTM, at, gey, drag,
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
