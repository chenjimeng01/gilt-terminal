#!/usr/bin/env node
// Gilt ladder calculator — command-line front end for the Gilt Terminal engine.
//
//   node scripts/ladder.mjs <input.json> [options]
//
//   --prices <file>      gilt-prices.json to use (skips the live fetch)
//   --prices-url <url>   fetch gilt-prices.json from this URL (default: the
//                        pricesUrl in config.json, i.e. the Gilt Terminal site)
//   --offline            don't fetch; use the bundled snapshot
//   By default the script fetches the live file and falls back to the bundled
//   snapshot (data/gilt-prices.json) if that fails; the report says which.
//   --json <file>        also write the full result as JSON
//   --csv <file>         also write the rung table as CSV
//   --today <date>       treat this as today (YYYY-MM-DD); default: the real date
//
// Prints a Markdown report. Exits 1 with a message if the input is invalid.
// The maths lives in ./engine (copied from the Gilt Terminal repository by its
// build script); this file only validates input, calls the engine and checks
// and formats the result. Nothing here does gilt arithmetic of its own except
// the funding check, which re-adds the engine's own dated cash flows.

import fs from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { buildLadder, buildLadderWithBands, solveIRR, toDate } from "./engine/ladderEngine.js";
import { MASTER } from "./engine/giltUniverse.js";
import { priceSettlement } from "./engine/giltMath.js";
import { savingsRates, taxYearStart, taxYearName } from "./engine/ukTax.js";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_PRICES = resolve(HERE, "../data/gilt-prices.json");
const CONFIG = resolve(HERE, "../config.json");
const YEAR = 365.25 * 86400000;
const STALE_DAYS = 4;
const iso = d => d.toISOString().slice(0, 10);
const gbp = (n, dp = 0) => (n < 0 ? "−£" : "£") + Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const pct = (x, dp = 3) => (x == null ? "—" : (x * 100).toFixed(dp) + "%");

// ── Input ────────────────────────────────────────────────────────────────────

const BANDS = { basic: 0, higher: 1, additional: 2 };

/**
 * Validate and normalise the input object. Returns { ok, errors, input }.
 * See SKILL.md for the format.
 */
export function validateInput(raw, { today = new Date() } = {}) {
  const errors = [];
  const r = raw && typeof raw === "object" ? raw : {};
  const settlement = r.settlement ? toDate(r.settlement) : priceSettlement(null, today);
  if (Number.isNaN(+settlement)) errors.push(`settlement "${r.settlement}" is not a date (use YYYY-MM-DD).`);

  const liabilities = [];
  if (!Array.isArray(r.liabilities) || !r.liabilities.length) {
    errors.push("liabilities: give a list of { date, amount } — one per payout.");
  } else {
    r.liabilities.forEach((l, i) => {
      const d = typeof l?.date === "string" && /^\d{4}-\d{2}(-\d{2})?$/.test(l.date) ? toDate(l.date) : null;
      const a = Number(l?.amount);
      if (!d || Number.isNaN(+d)) errors.push(`liabilities[${i}].date "${l?.date}" must be YYYY-MM or YYYY-MM-DD.`);
      else if (!Number.isNaN(+settlement) && d <= settlement) errors.push(`liabilities[${i}] (${l.date}) is on or before settlement ${iso(settlement)}.`);
      if (!(a > 0) || !Number.isFinite(a)) errors.push(`liabilities[${i}].amount must be a positive number of pounds.`);
      if (d && a > 0) liabilities.push({ date: l.date, amount: a, label: l.label ?? null });
    });
  }

  const account = String(r.account ?? "GIA").toUpperCase();
  if (!["GIA", "ISA", "SIPP"].includes(account)) errors.push(`account must be GIA, ISA or SIPP (got "${r.account}").`);

  // Tax on coupons (GIA only): one of { rate }, { band }, { otherIncome, otherSavings }.
  let tax = { mode: "none" };
  if (account === "GIA") {
    const t = r.tax ?? {};
    if (t.otherIncome != null) {
      const oi = Number(t.otherIncome), os = Number(t.otherSavings ?? 0);
      if (!(oi >= 0) || !(os >= 0)) errors.push("tax.otherIncome / tax.otherSavings must be numbers ≥ 0.");
      tax = { mode: "bands", profile: { otherIncome: oi, otherSavings: os } };
    } else if (t.band != null) {
      if (!(t.band in BANDS)) errors.push(`tax.band must be basic, higher or additional (got "${t.band}").`);
      tax = { mode: "band", band: t.band };
    } else if (t.rate != null) {
      const rt = Number(t.rate);
      if (!(rt >= 0 && rt < 1)) errors.push("tax.rate must be a fraction between 0 and 1, e.g. 0.4.");
      tax = { mode: "flat", rate: rt };
    } else {
      errors.push("tax: a GIA needs one of { rate: 0.4 }, { band: \"higher\" } or { otherIncome: 60000, otherSavings: 0 }.");
    }
  }

  const sizing = r.sizing ?? "couponOffset";
  if (!["couponOffset", "simple"].includes(sizing)) errors.push(`sizing must be couponOffset or simple (got "${sizing}").`);
  // Default: lowest coupon for a GIA (its after-tax ranking settles with band
  // tax and it limits taxable income); highest net yield where coupons are untaxed.
  const selection = r.selection ?? (account === "GIA" ? "lowCoupon" : "netYield");
  if (!["netYield", "lowCoupon"].includes(selection)) errors.push(`selection must be netYield or lowCoupon (got "${selection}").`);

  const num = (v, dflt, name, ok) => {
    if (v == null) return dflt;
    const n = Number(v);
    if (!ok(n)) errors.push(`${name} is out of range (got ${v}).`);
    return n;
  };
  const windowMonths = num(r.windowMonths, 12, "windowMonths", n => n >= 1 && n <= 36);
  const incrementGBP = num(r.incrementGBP, 100, "incrementGBP", n => n >= 1);
  const cashRate = num(r.cashRate, 0, "cashRate", n => n >= 0 && n < 0.2);
  const inflation = num(r.inflation, 0, "inflation", n => n >= 0 && n < 0.2);
  const benchmarkCashRate = r.benchmarkCashRate == null ? null : num(r.benchmarkCashRate, null, "benchmarkCashRate", n => n >= 0 && n < 0.2);
  const dc = r.dealingCosts ?? {};
  const dealingCosts = {
    perTrade: num(dc.perTrade, 0, "dealingCosts.perTrade", n => n >= 0),
    percent: num(dc.percent, 0, "dealingCosts.percent", n => n >= 0 && n < 5),
  };

  const prices = {};
  for (const [sym, v] of Object.entries(r.prices ?? {})) {
    const n = Number(v);
    if (!(n > 1 && n < 250)) errors.push(`prices.${sym} must be a clean price per £100 between 1 and 250.`);
    else if (!MASTER.some(g => g.sym === sym)) errors.push(`prices.${sym}: unknown ticker.`);
    else prices[sym] = n;
  }
  const choices = {};
  for (const [d, sym] of Object.entries(r.choices ?? {})) choices[iso(toDate(d))] = sym;

  return {
    ok: errors.length === 0,
    errors,
    input: {
      settlement, liabilities, account, tax, sizing, selection, windowMonths, incrementGBP,
      cashRate, inflation, benchmarkCashRate, dealingCosts, prices, choices,
      clientRef: r.clientRef ?? null,
    },
  };
}

// ── Prices ───────────────────────────────────────────────────────────────────

function parsePrices(j, origin, kind) {
  if (!j?.prices || typeof j.prices !== "object") throw new Error(`${origin} has no "prices" object`);
  return { asOf: j.asOf ?? null, prices: j.prices, dirty: j.dirty ?? {}, settlement: j.settlement ?? null, origin, kind, note: null };
}

/** Read a gilt-prices.json file. */
export function loadPrices(file, kind = "file") {
  return parsePrices(JSON.parse(fs.readFileSync(file, "utf8")), file, kind);
}

/**
 * Fetch a gilt-prices.json from a URL. Tries Node's fetch, then curl: sandboxes
 * often reach the internet only through an HTTPS proxy, which curl honours
 * (HTTPS_PROXY) and Node's fetch does not.
 */
export async function fetchPrices(url, { timeoutMs = 15000 } = {}) {
  const errs = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parsePrices(await res.json(), url, "live");
  } catch (e) { errs.push(`fetch: ${e.cause?.code || e.message}`); }
  try {
    const body = execFileSync("curl", ["-sSfL", "--max-time", String(Math.ceil(timeoutMs / 1000)), url],
      { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 5e6 }).toString();
    return parsePrices(JSON.parse(body), url, "live");
  } catch (e) { errs.push(`curl: ${(e.stderr?.toString().trim() || e.message).split("\n")[0]}`); }
  throw new Error(errs.join("; "));
}

/**
 * Prices to use: an explicit file; else the live URL; else the bundled
 * snapshot, with a note saying why the live fetch was not used.
 */
export async function resolvePrices({ file = null, url = null, offline = false, bundled = DEFAULT_PRICES } = {}) {
  if (file) return loadPrices(file, "file");
  if (url && !offline) {
    try { return await fetchPrices(url); }
    catch (e) {
      const p = loadPrices(bundled, "bundled");
      p.note = `Could not fetch live prices from ${url} (${e.message}); used the prices bundled with the skill, as of ${p.asOf}.`;
      return p;
    }
  }
  return loadPrices(bundled, "bundled");
}

/** The live-prices URL from config.json, if set. */
export function configuredPricesUrl() {
  try { return JSON.parse(fs.readFileSync(CONFIG, "utf8")).pricesUrl || null; } catch { return null; }
}

// ── Calculation ──────────────────────────────────────────────────────────────

/** Run the ladder. `priceData` from loadPrices. Returns a plain result object. */
export function runLadder(input, priceData, { today = new Date() } = {}) {
  const { tax, account } = input;
  const taxRate =
    tax.mode === "flat" ? tax.rate :
    tax.mode === "band" ? (d => savingsRates(taxYearStart(d))[BANDS[tax.band]]) :
    0;

  const opts = {
    liabilities: input.liabilities.map(l => ({ date: l.date, amount: l.amount })),
    accountType: account,
    taxRate,
    preference: input.selection,
    windowMonths: input.windowMonths,
    settlement: input.settlement,
    universe: MASTER,
    prices: { ...priceData.prices, ...input.prices },
    // The DMO dirty prices are only valid for their own settlement date and
    // only for the file's clean prices, never for a manual override.
    dirtyPrices: Object.fromEntries(Object.entries(priceData.dirty || {}).filter(([s]) => !(s in input.prices))),
    dirtySettlement: priceData.settlement,
    incrementGBP: input.incrementGBP,
    cashNetRate: input.cashRate,
    inflation: input.inflation,
    sizing: input.sizing,
    choices: input.choices,
  };
  const out = tax.mode === "bands" ? buildLadderWithBands(opts, tax.profile) : buildLadder(opts);

  const filled = out.rungs.filter(r => !r.unfillable);
  const bought = filled.filter(r => r.nominal > 0);
  const settle = out.settlement;

  // Funding check: every dated inflow (after-tax coupon, redemption) is
  // assigned to the first payout on or after its date and carried there at
  // cashRate. Each payout must be covered.
  const needDates = filled.map(r => r.liabilityDate);
  const funding = filled.map(r => ({ needDate: r.liabilityDate, need: r.liability, fromRedemptions: 0, fromCoupons: 0 }));
  const grow = (from, to) => Math.pow(1 + input.cashRate, (to - from) / YEAR);
  const assign = (date, cf, kind) => {
    const j = needDates.findIndex(d => d >= date);
    if (j < 0) return;
    const v = cf * grow(date, needDates[j]);
    if (kind === "redemption") funding[j].fromRedemptions += v; else funding[j].fromCoupons += v;
  };
  for (const r of bought) {
    for (const c of r.couponFlows) assign(c.date, c.net, "coupon");
    assign(toDate(r.gilt.mat), r.nominal, "redemption");
  }
  for (const f of funding) {
    f.available = f.fromRedemptions + f.fromCoupons;
    f.surplus = f.available - f.need;
    f.covered = f.surplus >= -0.005;
  }

  // Dealing costs: added to the capital at settlement; the IRR is shown both ways.
  const t = out.totals;
  const dealing = input.dealingCosts.perTrade * bought.length + (input.dealingCosts.percent / 100) * t.cost;
  const allFlows = filled.flatMap(r => r.cashflows);
  const irrWithCosts = dealing > 0 ? solveIRR([...allFlows, { t: 0, cf: -dealing }]) : t.portfolioIRR;

  // Optional benchmark: a cash deposit at benchmarkCashRate meeting the same payouts.
  let benchmark = null;
  if (input.benchmarkCashRate != null) {
    const r = input.benchmarkCashRate;
    const cashNeeded = filled.reduce((s, x) => s + x.liability / Math.pow(1 + r, (x.liabilityDate - settle) / YEAR), 0);
    const inflowsPV = allFlows.filter(f => f.t > 0).reduce((s, f) => s + f.cf / Math.pow(1 + r, f.t), 0);
    benchmark = { rate: r, cashNeeded, ladderAdvantage: inflowsPV - (t.cost + dealing) };
  }

  const warnings = [...out.warnings];
  if (priceData.note) warnings.unshift(priceData.note);
  const ageDays = priceData.asOf ? Math.floor((today - new Date(priceData.asOf + "T00:00:00Z")) / 86400000) : null;
  if (ageDays == null) warnings.push("The price file has no date: check the prices before relying on the figures.");
  else if (ageDays > STALE_DAYS) warnings.push(`Prices are ${ageDays} days old (as of ${priceData.asOf}). Re-run with a current price file or the client's dealing prices.`);
  if (out.warnings.some(w => /did not settle/.test(w))) {
    warnings.push("Because the tax did not settle, the coupons in the funding check are taxed at an approximate rate. Re-run with \"selection\": \"lowCoupon\" (which settles) before relying on these figures.");
  }
  if (funding.some(f => !f.covered)) warnings.push("At least one payout is NOT fully covered — see the funding check.");
  const unfillable = out.rungs.filter(r => r.unfillable);
  if (unfillable.length) warnings.push(`${unfillable.length} payout(s) fall after the longest suitable gilt and are NOT funded: ${unfillable.map(r => iso(r.liabilityDate)).join(", ")}.`);

  return {
    meta: {
      clientRef: input.clientRef,
      today: iso(today),
      settlement: iso(settle),
      prices: { asOf: priceData.asOf, kind: priceData.kind, origin: priceData.origin, ageDays, overrides: Object.keys(input.prices) },
      account,
      tax: tax.mode === "flat" ? `flat ${(tax.rate * 100).toFixed(1)}% on coupons`
        : tax.mode === "band" ? `${tax.band}-rate savings band each year (${savingsRates(2026)[BANDS[tax.band]] * 100}% in 2026/27, ${savingsRates(2027)[BANDS[tax.band]] * 100}% from 2027/28)`
        : tax.mode === "bands" ? `UK bands from other income £${tax.profile.otherIncome.toLocaleString("en-GB")} and other savings income £${tax.profile.otherSavings.toLocaleString("en-GB")} a year`
        : `${account}: coupons untaxed`,
      sizing: input.sizing,
      selection: input.selection,
      windowMonths: input.windowMonths,
      incrementGBP: input.incrementGBP,
      cashRate: input.cashRate,
      inflation: input.inflation,
    },
    summary: {
      capitalRequired: t.cost,
      dealingCosts: dealing,
      capitalIncludingCosts: t.cost + dealing,
      portfolioIRR: t.portfolioIRR,
      portfolioIRRIncludingCosts: irrWithCosts,
      totalPayouts: t.liability,
      totalNominal: t.nominal,
      netCoupons: t.netCoupons,
      gilts: bought.length,
      allCovered: funding.every(f => f.covered) && !unfillable.length,
      taxSettled: !out.warnings.some(w => /did not settle/.test(w)),
    },
    rungs: filled.map(r => ({
      needDate: iso(r.liabilityDate),
      need: r.liability,
      gilt: { name: r.gilt.name, epic: r.gilt.sym, isin: r.gilt.isin ?? null, coupon: r.gilt.c, maturity: r.gilt.mat },
      cleanPrice: r.cleanPx,
      accrued: r.ai,
      dirtyPrice: r.dirtyPx,
      exDividend: r.exDiv,
      nominal: r.nominal,
      cost: r.cost,
      netCoupons: r.netCoupons,
      netIRR: r.netIRR,
      daysRedeemedEarly: Math.round(r.idleYears * 365.25),
      gapFilled: r.gapFilled,
      selectedBy: r.selectedBy,
      alternatives: (r.candidates || []).filter(c => !c.selected).map(c => c.gilt.sym),
    })),
    unfunded: unfillable.map(r => ({ needDate: iso(r.liabilityDate), need: r.liability })),
    funding: funding.map(f => ({ ...f, needDate: iso(f.needDate) })),
    taxByYear: out.taxBands ? out.taxBands.byYear.map(y => ({ taxYear: y.label ?? taxYearName(y.year), interest: y.interest, tax: y.tax, rate: y.rate })) : null,
    benchmark,
    warnings,
  };
}

// ── Output ───────────────────────────────────────────────────────────────────

export function renderMarkdown(res) {
  const m = res.meta, s = res.summary;
  const L = [];
  L.push(`# Gilt ladder${m.clientRef ? ` — ${m.clientRef}` : ""}`);
  L.push("");
  const src = m.prices.kind === "live" ? `live from ${m.prices.origin.replace(/^https?:\/\//, "")}`
    : m.prices.kind === "bundled" ? "bundled with the skill" : `from ${m.prices.origin}`;
  L.push(`Prices: DMO reference prices as of **${m.prices.asOf ?? "unknown"}** (${src})${m.prices.overrides.length ? `, overridden: ${m.prices.overrides.join(", ")}` : ""} · settlement **${m.settlement}** · ${m.account}, ${m.tax}.`);
  L.push("");
  L.push("| | |");
  L.push("|---|---|");
  L.push(`| **Capital required today** | **${gbp(s.capitalRequired)}** |`);
  if (s.dealingCosts > 0) L.push(`| Dealing costs (as entered) | ${gbp(s.dealingCosts)} |`, `| Capital including dealing costs | ${gbp(s.capitalIncludingCosts)} |`);
  L.push(`| Portfolio IRR after tax (annual effective) | ${pct(s.portfolioIRR)} |`);
  if (s.dealingCosts > 0) L.push(`| IRR including dealing costs | ${pct(s.portfolioIRRIncludingCosts)} |`);
  L.push(`| Total payouts funded | ${gbp(s.totalPayouts)} over ${res.rungs.length} dates |`);
  L.push(`| Gilts to buy / total nominal | ${s.gilts} / ${gbp(s.totalNominal)} |`);
  L.push(`| Net coupons received | ${gbp(s.netCoupons)} |`);
  L.push(`| Every payout covered | ${!s.allCovered ? "**NO — see warnings**" : s.taxSettled ? "Yes" : "Yes, but tax approximate — see warnings"} |`);
  L.push("");
  L.push("## Gilts");
  L.push("");
  L.push("| Payout date | Payout | Gilt | EPIC | ISIN | Matures | Clean | Dirty | Nominal | Cost | Net coupons | Days early |");
  L.push("|---|---:|---|---|---|---|---:|---:|---:|---:|---:|---:|");
  for (const r of res.rungs) {
    const flags = [r.exDividend && "ex-div", r.gapFilled && "wider window", r.selectedBy === "user" && "your choice", r.nominal === 0 && "covered by coupons"].filter(Boolean);
    L.push(`| ${r.needDate} | ${gbp(r.need)} | ${r.gilt.name}${flags.length ? ` (${flags.join(", ")})` : ""} | ${r.gilt.epic} | ${r.gilt.isin ?? "—"} | ${r.gilt.maturity} | ${r.cleanPrice.toFixed(2)} | ${r.dirtyPrice.toFixed(4)} | ${gbp(r.nominal)} | ${gbp(r.cost, 2)} | ${gbp(r.netCoupons)} | ${r.daysRedeemedEarly} |`);
  }
  L.push("");
  L.push(`## Funding check${m.cashRate > 0 ? ` (cash held until needed earns ${(m.cashRate * 100).toFixed(2)}%)` : " (cash held until needed earns nothing)"}`);
  L.push("");
  L.push("| Payout date | Needed | From redemptions | From coupons | Available | Surplus |");
  L.push("|---|---:|---:|---:|---:|---:|");
  for (const f of res.funding) {
    L.push(`| ${f.needDate} | ${gbp(f.need)} | ${gbp(f.fromRedemptions)} | ${gbp(f.fromCoupons)} | ${gbp(f.available)} | ${f.covered ? gbp(f.surplus) : "**" + gbp(f.surplus) + " SHORT**"} |`);
  }
  for (const u of res.unfunded) L.push(`| ${u.needDate} | ${gbp(u.need)} | — | — | — | **not funded** |`);
  if (res.taxByYear?.length) {
    L.push("", "## Tax on coupons by tax year", "", "| Tax year | Taxable interest | Tax | Average rate |", "|---|---:|---:|---:|");
    for (const y of res.taxByYear) L.push(`| ${y.taxYear} | ${gbp(y.interest)} | ${gbp(y.tax)} | ${pct(y.rate, 1)} |`);
  }
  if (res.benchmark) {
    const b = res.benchmark;
    L.push("", `## Against cash at ${(b.rate * 100).toFixed(2)}% net`, "",
      `Cash deposit needed today to meet the same payouts: ${gbp(b.cashNeeded)}. Ladder minus cash (all ladder inflows valued at that rate, less its cost): ${b.ladderAdvantage >= 0 ? "+" : ""}${gbp(b.ladderAdvantage)}.`);
  }
  if (res.warnings.length) {
    L.push("", "## Warnings", "");
    for (const w of res.warnings) L.push(`- ${w}`);
  }
  L.push("", "## Basis", "",
    `- Sizing: ${m.sizing === "couponOffset" ? "longest payout first; coupons (and early redemptions) received before each payout are counted towards it" : "each gilt's redemption alone covers its payout; coupons are surplus"}. Nominal rounded up to £${m.incrementGBP}.`,
    `- Gilt for each payout: the ${m.selection === "netYield" ? "highest after-tax yield" : "lowest coupon"} among gilts maturing up to ${m.windowMonths} months before it (widened if none).`,
    "- Prices are DMO mid prices; dealing prices (offer) will be slightly higher. Accrued interest and ex-dividend status are at the settlement date.",
    "- Coupons taxed as savings income (accrued income scheme applied); redemption gains are CGT-exempt. IRR is annual effective on the ladder's own cash flows.",
    m.inflation > 0 ? `- Payout amounts were grown at ${(m.inflation * 100).toFixed(2)}% a year from settlement.` : "- Payout amounts used exactly as entered (no inflation added).",
    "- A calculation for an adviser to review — not a recommendation or a suitability assessment.");
  return L.join("\n");
}

export function renderCsv(res) {
  const head = ["Payout date", "Payout GBP", "Gilt", "EPIC", "ISIN", "Maturity", "Coupon %", "Clean", "Dirty", "Nominal GBP", "Cost GBP", "Net coupons GBP", "Days redeemed early"];
  const rows = res.rungs.map(r => [r.needDate, r.need.toFixed(2), r.gilt.name, r.gilt.epic, r.gilt.isin ?? "", r.gilt.maturity, r.gilt.coupon,
    r.cleanPrice.toFixed(4), r.dirtyPrice.toFixed(4), r.nominal, r.cost.toFixed(2), r.netCoupons.toFixed(2), r.daysRedeemedEarly]);
  return [head, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n";
}

// ── CLI ──────────────────────────────────────────────────────────────────────

async function main(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--offline") args.offline = true;
    else if (a.startsWith("--")) args[a.slice(2)] = argv[++i];
    else args._.push(a);
  }
  if (!args._[0]) {
    console.error("Usage: node scripts/ladder.mjs <input.json> [--prices file | --prices-url url] [--json out.json] [--csv out.csv] [--today YYYY-MM-DD]");
    process.exit(2);
  }
  const today = args.today ? new Date(args.today + "T12:00:00Z") : new Date();
  const raw = JSON.parse(fs.readFileSync(args._[0], "utf8"));
  const v = validateInput(raw, { today });
  if (!v.ok) {
    console.error("Input problems:\n" + v.errors.map(e => "  - " + e).join("\n"));
    process.exit(1);
  }

  const priceData = await resolvePrices({
    file: args.prices ? resolve(args.prices) : null,
    url: args["prices-url"] || configuredPricesUrl(),
    offline: "offline" in args,
  });

  const res = runLadder(v.input, priceData, { today });
  if (args.json) fs.writeFileSync(args.json, JSON.stringify(res, null, 2));
  if (args.csv) fs.writeFileSync(args.csv, renderCsv(res));
  console.log(renderMarkdown(res));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(e => { console.error(e.stack || e.message); process.exit(1); });
}
