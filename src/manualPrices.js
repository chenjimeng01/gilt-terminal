// One-off manual prices: a live price the user types in for a single gilt.
//
// "One-off" means: held only in page memory for this visit. Never written to
// gilt-prices.json, localStorage, the URL or the ladder's share link, and gone
// on reload or when cleared.
//
// Arithmetic: a price typed in now is a price for normal settlement now, i.e.
// T+1 business day from today — not the settlement date of the DMO file. The
// gilt is therefore priced with accrued interest (and ex-dividend status) at
// that date. A dirty price is converted to clean at the same date, so clean
// and dirty entries of the same trade give identical yields. The DMO file's
// dirty price for that gilt is ignored, since it belongs to a different price.

import { settlementTerms, priceSettlement } from "./giltMath.js";

export const MIN_PX = 1;
export const MAX_PX = 250;
export const WARN_DEVIATION = 0.03; // warn if > 3% from the reference price

const iso = d => d.toISOString().slice(0, 10);

/** Settlement for a price entered at `now`: T+1 business day (weekends only). */
export function manualSettlement(now = new Date()) {
  return priceSettlement(null, now);
}

/**
 * Validate and convert a typed price for `gilt`.
 *   input:  the text typed (per £100 nominal)
 *   kind:   "clean" (the usual quoted price) or "dirty" (clean + accrued)
 *   opts.now:            when it was entered (default now)
 *   opts.referenceClean: the file/snapshot clean price, for a sanity warning
 *
 * Returns { ok: false, error } or
 *   { ok: true, sym, kind, input, clean, dirty, ai, exDiv, settlement, enteredAt, warning }
 */
export function makeManualPrice(gilt, input, kind = "clean", opts = {}) {
  const now = opts.now ?? new Date();
  const text = String(input ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    return { ok: false, error: "Enter a price per £100 nominal, e.g. 99.84." };
  }
  const v = Number(text);
  if (!(v >= MIN_PX && v <= MAX_PX)) {
    return { ok: false, error: `Price must be between ${MIN_PX} and ${MAX_PX} per £100 nominal.` };
  }

  const settlementDate = manualSettlement(now);
  const terms = settlementTerms(gilt.c, gilt.mat, settlementDate);
  if (!terms) return { ok: false, error: "This gilt has matured by the settlement date." };

  const clean = kind === "dirty" ? v - terms.ai : v;
  if (!(clean > 0)) return { ok: false, error: "That dirty price is below the accrued interest." };

  let warning = null;
  const ref = opts.referenceClean;
  if (Number.isFinite(ref) && ref > 0) {
    const dev = clean / ref - 1;
    if (Math.abs(dev) > WARN_DEVIATION) {
      warning = `${(Math.abs(dev) * 100).toFixed(1)}% ${dev < 0 ? "below" : "above"} the ` +
        `reference clean price of ${ref.toFixed(2)} — check it's the ${kind} price.`;
    }
  }

  return {
    ok: true,
    sym: gilt.sym,
    kind,
    input: v,
    clean,
    dirty: clean + terms.ai,
    ai: terms.ai,
    exDiv: terms.exDiv,
    settlement: iso(settlementDate),
    enteredAt: now.toISOString(),
    warning,
  };
}

/**
 * Price inputs for buildLadder with manual prices applied on top of the
 * file's: manual clean prices replace the file's, and the file's DMO dirty
 * prices are dropped for those gilts. The ladder then computes accrued at its
 * own settlement date from the manual clean price.
 */
export function ladderPriceInputs({ prices = {}, isLive, liveDirty = {}, dirtySettlement = null, manual = {} }) {
  const manualSyms = Object.keys(manual).filter(s => manual[s]?.ok);
  const outPrices = { ...prices };
  const dirtyPrices = isLive ? { ...liveDirty } : {};
  for (const s of manualSyms) {
    outPrices[s] = manual[s].clean;
    delete dirtyPrices[s];
  }
  return {
    prices: outPrices,
    dirtyPrices,
    dirtySettlement: isLive ? dirtySettlement : null,
    manualSyms,
  };
}
