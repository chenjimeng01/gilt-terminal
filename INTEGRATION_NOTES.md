# INTEGRATION_NOTES — Ladder Builder

Discovery findings before implementing `gilt-ladder-spec.md` v1.0, and where reality
diverges from the spec.

## Where things live

| Spec asks about | Found |
|---|---|
| Gilt universe | `MASTER` array inline in `src/GiltTerminal.jsx` — fields: `name`, `c` (coupon %), `mat` (maturity ISO date), `px` (fallback clean price), `ai` (snapshot accrued), `gy` (snapshot gross YTM), `sym` (LSE EPIC). All conventional gilts; **no index-linked gilts in the universe**, so the §3.1 exclusion is a no-op guard (name-based filter kept for safety). |
| Live prices | `fetch('/gilt-prices.json')` → `{ asOf, prices: { [sym]: cleanPx } }`. Clean mid only — **no dirty price, no ISIN, no coupon-date fields**. Refresh pipeline (`scripts/refresh-gilt-prices.js`) is deliberately decoupled and untouched. |
| Tax rate capture | `taxRate` state in `GiltTerminal` — slider 0–60% in 5% steps, stored as a fraction (0.45). No Scottish-rate enum exists, so per spec §2 the ladder follows the existing pattern and reuses the same slider state. |
| After-tax yield function | `solveYTM(coupon, matStr, cleanPx, ai, taxRate)` in `GiltTerminal.jsx` — bisection over exact coupon schedule, semi-annual compounding, redemption CGT-exempt. Reused as the "net redemption yield" selection metric. |
| Styling / routing | Inline style objects (`s = {...}`), no router, no tabs, no charting lib. Ladder is a view toggle in the header; cashflow chart is inline SVG per §4.2 fallback. Analyser has no mobile card collapse, so the ladder table uses the same `overflowX: auto` pattern. |
| Tests | None existed. Golden tests use Node's built-in `node --test` (zero new dependencies), `npm test`. |

## Changes to existing code (kept surgical)

- `src/giltMath.js` (new): `futureCouponDates`, `calcAI`, `solveYTM` moved **verbatim** out of
  `GiltTerminal.jsx` so the ladder engine and Node tests can import the same code the page uses
  (spec ground rule 3). Only change: each takes an optional trailing `now` parameter defaulting
  to module-load time — identical behaviour for the analyser, deterministic for tests.
- `src/giltUniverse.js` (new): `MASTER` moved verbatim so the ladder can share the universe.
  The refresh script's duplicate `GILTS` list is untouched (see CLAUDE.md — the two halves
  share no runtime code, and that stays true).
- `src/GiltTerminal.jsx`: imports the above instead of defining them; adds the Ladder/Analyser
  header toggle and mounts `LadderView`. Analyser logic, maths and styles unchanged.

## Mismatches with the spec & resolutions

1. **No ISIN anywhere in the data layer.** Outputs (§4.1 table, §4.4 dealing ticket) use the
   LSE EPIC (`sym`, e.g. `TN34`) instead, labelled as such. ISINs were *not* invented.
   *Smallest proposed extension:* add an `isin` field to `MASTER` rows (one-off manual lookup
   against the DMO gilts-in-issue list); engine and UI already pass the whole gilt row through,
   so populating it lights up ISIN display with no further code change.
2. **No dirty price in the data layer.** Dirty = clean + accrued, with accrued computed at the
   settlement date by the existing `calcAI` (Actual/Actual), per §3.4's fallback formula.
3. **Coupon dates** are derivable (walk back 6 months from maturity — existing
   `futureCouponDates` convention), so the §3.4 ex-div rule *is* implemented: if settlement
   falls within 7 **business days** (weekends excluded; UK bank holidays not modelled — noted
   in the UI tooltip) before the next coupon date, that coupon is skipped and accrued is
   negative from settlement to the coupon date.
4. **Coupon taxation differs from the analyser on the first coupon.** The analyser treats
   purchased accrued as return-of-capital on coupon one; spec §3.4 taxes every coupon in full
   (`N·c/2·(1−t)`). The engine follows the spec (simpler, conservative — slightly understates
   net IRR in a GIA). Selection tiebreaks still use the analyser's `solveYTM` untouched.
5. **Cash-alternative default rate:** the terminal has no existing cash-rate assumption, so the
   spec's 3.0% net default applies.
6. **Settlement default** is T+1 skipping weekends only (no bank-holiday calendar in the app).

## Out of scope honoured

Coupon-offset sizing, index-linked, PSA modelling, rolling ladders, multi-account — none built.
