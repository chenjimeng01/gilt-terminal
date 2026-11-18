import { useState, useEffect, useMemo, Fragment } from "react";
import { MASTER } from "./giltUniverse.js";
import { buildLadder, buildLadderWithBands, quickFill, addBusinessDays, toDate } from "./ladderEngine.js";
import { ladderPriceInputs } from "./manualPrices.js";
import PriceEditor from "./PriceEditor.jsx";
import BrokerLinks from "./BrokerLinks.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import { s as base } from "./styles.js";

const MAX_RUNGS = 20;

const s = {
  ...base,
  editBtn: { ...base.editBtn, marginLeft: 5 },
  manualBadge: { ...base.manualBadge, marginRight: 5 },
};

const gbp = (n, dp = 0) => "£" + n.toLocaleString("en-GB", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const ymLabel = d => toDate(d).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const isoDay = d => d.toISOString().slice(0, 10);

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// ── URL-hash state (§4.4): inputs only, never prices ─────────────────────────
function readHash() {
  try {
    const m = window.location.hash.match(/^#ladder=(.+)$/);
    return m ? JSON.parse(decodeURIComponent(m[1])) : null;
  } catch { return null; }
}
function writeHash(state) {
  const h = "#ladder=" + encodeURIComponent(JSON.stringify(state));
  window.history.replaceState(null, "", h);
}

function defaultLiabilities() {
  const y = new Date().getUTCFullYear();
  const m = String(new Date().getUTCMonth() + 1).padStart(2, "0");
  return [2, 3, 4].map(k => ({ date: `${y + k}-${m}`, amount: 50000 }));
}

// ── Cashflow chart — inline SVG (no charting lib in the app) ─────────────────
function CashflowChart({ result }) {
  const filled = result.rungs.filter(r => !r.unfillable);
  if (!filled.length) return null;

  const t0 = result.settlement;
  const flows = [];
  let cost = 0;
  for (const r of filled) {
    cost += r.cost;
    for (const c of r.couponFlows) flows.push({ date: c.date, v: c.net, kind: "coupon" });
    flows.push({ date: toDate(r.gilt.mat), v: r.nominal, kind: "redemption" });
  }
  const tEnd = Math.max(...flows.map(f => +f.date), ...filled.map(r => +r.liabilityDate));
  const span = Math.max(tEnd - +t0, 1);
  const W = 860, H = 170, PAD = 24, mid = 108;
  const x = d => PAD + ((+d - +t0) / span) * (W - 2 * PAD);
  const maxIn = Math.max(...flows.map(f => f.v), cost);
  const yUp = v => Math.max(2, (v / maxIn) * 80);

  const years = [];
  for (let y = t0.getUTCFullYear() + 1; y <= new Date(tEnd).getUTCFullYear(); y++) {
    years.push(new Date(Date.UTC(y, 0, 1)));
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      {years.map(d => (
        <g key={+d}>
          <line x1={x(d)} y1={16} x2={x(d)} y2={mid + 34} stroke="var(--track)" strokeWidth="1" />
          <text x={x(d)} y={H - 14} fontSize="10" fill="var(--text-3)" textAnchor="middle" fontFamily="var(--font-num)">{d.getUTCFullYear()}</text>
        </g>
      ))}
      <line x1={PAD} y1={mid} x2={W - PAD} y2={mid} stroke="var(--border-strong)" strokeWidth="1" />
      {/* outflow at settlement */}
      <rect x={x(t0) - 3} y={mid} width="6" height={yUp(cost) * 0.4 + 8} fill="var(--neg)" rx="1">
        <title>{`Settlement ${isoDay(t0)}: −${gbp(cost)}`}</title>
      </rect>
      {/* coupons + redemptions */}
      {flows.map((f, i) => (
        <rect key={i} x={x(f.date) - (f.kind === "redemption" ? 3 : 1)} y={mid - yUp(f.v)}
          width={f.kind === "redemption" ? 6 : 2} height={yUp(f.v)}
          fill={f.kind === "redemption" ? "var(--accent)" : "var(--accent-2)"} rx="1">
          <title>{`${isoDay(toDate(f.date))}: +${gbp(f.v)} ${f.kind}`}</title>
        </rect>
      ))}
      {/* liability markers */}
      {filled.map((r, i) => (
        <g key={i} transform={`translate(${x(r.liabilityDate)}, ${mid + 16})`}>
          <path d="M0 -5 L5 0 L0 5 L-5 0 Z" fill="none" stroke="var(--info)" strokeWidth="1.5">
            <title>{`Liability ${ymLabel(r.liabilityDate)}: ${gbp(r.liability)}`}</title>
          </path>
        </g>
      ))}
      <text x={PAD} y={12} fontSize="10" fill="var(--text-3)" fontFamily="var(--font-num)">inflows ↑ (coupons light, redemptions dark) · outflow ↓ red · liabilities ◇</text>
    </svg>
  );
}

// ── Candidate gilts for one rung ─────────────────────────────────────────────
// Every gilt maturing in the rung's window, in maturity order (not ranked),
// with the same figures for each. The user chooses which one the calculation
// uses; nothing here marks one as preferable.
function CandidateList({ rung, colSpan, onChoose, onReset, onClose }) {
  const cell = { padding: "5px 10px", fontSize: "0.75rem", whiteSpace: "nowrap", borderBottom: "1px solid var(--separator)" };
  const head = { ...cell, fontSize: "0.6875rem", fontWeight: 500, color: "var(--text-3)", letterSpacing: "0.04em" };
  const R = { textAlign: "right" };
  return (
    <tr>
      <td colSpan={colSpan} style={{ background: "var(--bg)", borderBottom: "1px solid var(--separator)", padding: "12px 14px" }}>
        <div className="gt-reveal" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 6, fontSize: "0.75rem", color: "var(--text-2)" }}>
          <span>
            <strong style={{ color: "var(--text)", fontWeight: 500 }}>Gilts maturing in the window for {ymLabel(rung.liabilityDate)}</strong>
            {" "}— listed by maturity date, not ranked. Choose which one this rung's calculation uses.
          </span>
          <span style={{ display: "inline-flex", gap: 6 }}>
            {rung.selectedBy === "user" && <button style={s.btn} onClick={onReset}>Use my selection rule</button>}
            <button style={s.btn} onClick={onClose}>Close</button>
          </span>
        </div>
        <table style={{ borderCollapse: "collapse", background: "var(--surface)", border: "1px solid var(--separator)", borderRadius: 10, overflow: "hidden", borderSpacing: 0 }}>
          <thead>
            <tr>
              <th style={{ ...head, textAlign: "left" }}>Gilt</th><th style={{ ...head, textAlign: "left" }}>EPIC</th>
              <th style={{ ...head, ...R }}>Maturity</th><th style={{ ...head, ...R }}>Coupon</th>
              <th style={{ ...head, ...R }}>Clean £</th><th style={{ ...head, ...R }}>Dirty £</th>
              <th style={{ ...head, ...R }} title="After-tax yield to maturity at your tax settings, semi-annual compounding.">Net yield (s.a.)</th>
              <th style={head} />
            </tr>
          </thead>
          <tbody>
            {rung.candidates.map(c => (
              <tr key={c.gilt.sym}>
                <td style={cell}>{c.gilt.name}{c.exDiv && <span style={{ ...s.badge, background: "var(--info-soft)", color: "var(--info)" }}>ex-div</span>}</td>
                <td style={{ ...cell, ...s.mono, color: "var(--text-3)" }}>{c.gilt.sym}</td>
                <td style={{ ...cell, ...R }}>{toDate(c.gilt.mat).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</td>
                <td style={{ ...cell, ...R, ...s.mono }}>{c.gilt.c.toFixed(3)}%</td>
                <td style={{ ...cell, ...R, ...s.mono }}>{c.cleanPx.toFixed(2)}</td>
                <td style={{ ...cell, ...R, ...s.mono }}>{c.dirtyPx.toFixed(2)}</td>
                <td style={{ ...cell, ...R, ...s.mono }}>{c.atYTM != null ? c.atYTM.toFixed(3) + "%" : "—"}</td>
                <td style={{ ...cell, ...R }}>
                  {c.selected
                    ? <span style={{ fontSize: "0.6875rem", color: "var(--text-2)" }}>in use</span>
                    : <button style={{ ...s.btn, padding: "3px 9px", fontSize: "0.6875rem" }} onClick={() => onChoose(c.gilt.sym)}
                        aria-label={`Use ${c.gilt.name} for this rung`}>Use this gilt</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

// ── Exports (§4.4) ────────────────────────────────────────────────────────────
function toCSV(result) {
  const head = ["Rung date", "Liability GBP", "Gilt", "EPIC", "Maturity", "Coupon %", "Clean", "Dirty", "Nominal GBP", "Cost GBP", "Net coupons GBP", "Redemption GBP", "Net IRR % (annual effective)", "Idle months", "Idle cash interest GBP", "Flags"];
  const rows = result.rungs.map(r => r.unfillable
    ? [ymLabel(r.liabilityDate), r.liability.toFixed(2), "UNFILLABLE", "", "", "", "", "", "", "", "", "", "", "", "", "unfillable"]
    : [ymLabel(r.liabilityDate), r.liability.toFixed(2), r.gilt.name, r.gilt.sym, r.gilt.mat, r.gilt.c,
       r.cleanPx.toFixed(2), r.dirtyPx.toFixed(4), r.nominal, r.cost.toFixed(2),
       r.netCoupons.toFixed(2), r.nominal, r.netIRR != null ? (r.netIRR * 100).toFixed(3) : "",
       r.idleMonths, r.idleInterest.toFixed(2),
       [r.gapFilled && "gap-filled", r.exDiv && "ex-div"].filter(Boolean).join(" ")]);
  const t = result.totals;
  rows.push(["TOTAL", t.liability.toFixed(2), "", "", "", "", "", "", t.nominal, t.cost.toFixed(2), t.netCoupons.toFixed(2), t.redemption,
    t.portfolioIRR != null ? (t.portfolioIRR * 100).toFixed(3) : "", "", t.idleInterest.toFixed(2), `WAL ${t.weightedAvgLife?.toFixed(1)}y`]);
  rows.push(["CASH BENCHMARK", `at ${(t.cashNetRate * 100).toFixed(2)}% net`, "cash needed", t.cashAlternative.toFixed(2),
    "ladder inflows PV", t.inflowsPV.toFixed(2), "ladder advantage", t.cashAdvantage.toFixed(2)]);
  return [head, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function LadderView({ taxRate, taxProfile = null, taxInputs, liveOverrides, isLive, asOf, snapshotLabel = "", liveDirty = {}, dirtySettlement = null, manual = {}, setManual }) {
  const [editing, setEditing] = useState(null);
  const [listing, setListing] = useState(null); // rung index whose candidate list is open
  const saved = useMemo(readHash, []);
  const [rows, setRows] = useState(saved?.rows ?? defaultLiabilities());
  const [account, setAccount] = useState(saved?.account ?? "GIA");
  const [pref, setPref] = useState(saved?.pref ?? "lowCoupon");
  const [windowMonths, setWindowMonths] = useState(saved?.w ?? 12);
  const [increment, setIncrement] = useState(saved?.inc ?? 100);
  const [settle, setSettle] = useState(saved?.settle ?? isoDay(addBusinessDays(new Date(), 1)));
  const [cashRate, setCashRate] = useState(saved?.cash ?? 3.0);
  const [inflation, setInflation] = useState(saved?.infl ?? 0);
  const [sizing, setSizing] = useState(saved?.sizing ?? "simple");
  // The user's own choice of gilt per rung, keyed by liability date (YYYY-MM-DD).
  const [choices, setChoices] = useState(saved?.ch ?? {});
  const [qf, setQf] = useState({ amount: 50000, years: 3, start: defaultLiabilities()[0].date });
  const [copied, setCopied] = useState(null);

  const inputs = useMemo(
    () => ({ rows, account, pref, w: windowMonths, inc: increment, settle, cash: cashRate, infl: inflation, sizing, ch: choices, taxRate, taxProfile }),
    [rows, account, pref, windowMonths, increment, settle, cashRate, inflation, sizing, choices, taxRate, taxProfile]
  );
  const dIn = useDebounced(inputs, 250); // §5: recompute debounced 250ms

  useEffect(() => {
    const { taxRate: _t, taxProfile: _p, ...toSave } = dIn; // tax inputs never go in the URL
    writeHash(toSave);
  }, [dIn]);

  // File prices with the user's one-off live prices on top (their DMO dirty
  // prices dropped — the ladder computes accrued at its own settlement).
  const priceInputs = useMemo(
    () => ladderPriceInputs({ prices: liveOverrides, isLive, liveDirty, dirtySettlement, manual }),
    [liveOverrides, isLive, liveDirty, dirtySettlement, manual]
  );

  const result = useMemo(() => (dIn.taxProfile
    ? o => buildLadderWithBands(o, dIn.taxProfile) : buildLadder)({
    liabilities: dIn.rows,
    accountType: dIn.account,
    taxRate: dIn.taxRate,
    preference: dIn.pref,
    windowMonths: Number(dIn.w) || 12,
    settlement: dIn.settle,
    universe: MASTER,
    prices: priceInputs.prices,
    dirtyPrices: priceInputs.dirtyPrices,
    dirtySettlement: priceInputs.dirtySettlement,
    incrementGBP: Math.max(1, Number(dIn.inc) || 100),
    cashNetRate: (Number(dIn.cash) || 3) / 100,
    inflation: (Number(dIn.infl) || 0) / 100,
    sizing: dIn.sizing === "couponOffset" ? "couponOffset" : "simple",
    choices: dIn.ch || {},
  }), [dIn, priceInputs]);

  const t = result.totals;
  const bands = result.taxBands ?? null; // band-based coupon tax by tax year, when in use
  const bandYear = Object.fromEntries((bands?.byYear ?? []).map(y => [y.label, y]));
  const filled = result.rungs.filter(r => !r.unfillable);
  const vsCash = t.cashAdvantage;
  const inflOn = t.inflation > 0;
  const nManual = priceInputs.manualSyms.length;
  const priceStamp = (isLive && asOf ? `Prices as of ${asOf}` : `Prices: snapshot ${snapshotLabel} (fallback)`) +
    (nManual ? ` + ${nManual} live price${nManual > 1 ? "s" : ""} you entered` : "");

  const setRow = (i, patch) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows(rs => rs.length >= MAX_RUNGS ? rs : [...rs, { date: rs.at(-1)?.date ?? defaultLiabilities()[0].date, amount: 50000 }]);
  const delRow = i => setRows(rs => rs.filter((_, k) => k !== i));
  const applyQuickFill = () => setRows(quickFill(Number(qf.amount) || 0, Math.min(MAX_RUNGS, Number(qf.years) || 1), qf.start));

  const copy = (label, text) => navigator.clipboard.writeText(text).then(() => {
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  });
  const dealingTicket = () => filled.filter(r => r.nominal > 0).map(r => `${r.gilt.sym}${r.gilt.isin ? ` (ISIN ${r.gilt.isin})` : ""} — nominal ${gbp(r.nominal)}`).join("\n");

  const empty = rows.filter(r => Number(r.amount) > 0).length === 0;

  return (
    <div className="gt-layout">
      {/* Sidebar — ladder inputs (§2) */}
      <SettingsPanel label="Account, tax & ladder">
        <div>
          <div style={s.secLbl}>Account & tax</div>
          <div style={{ marginBottom: "0.7rem" }}>
            <div style={{ ...s.fieldRow, marginBottom: 3 }}><span>Account type</span></div>
            <select style={s.selectEl} value={account} onChange={e => setAccount(e.target.value)}>
              <option value="GIA">GIA — coupons taxed</option>
              <option value="ISA">ISA — no tax</option>
              <option value="SIPP">SIPP — no tax</option>
            </select>
          </div>
          {account === "GIA" && taxInputs}
        </div>

        <hr style={s.hr} />

        <div>
          <div style={s.secLbl}>Ladder settings</div>
          <div style={{ marginBottom: "0.7rem" }}>
            <div style={{ ...s.fieldRow, marginBottom: 3 }}><span title="The rule you choose for which gilt the calculator shows when several mature in the window. It is a mechanical filter, not a view on which gilt is suitable.">Selection rule (your choice) ▲</span></div>
            <select style={s.selectEl} value={pref} onChange={e => setPref(e.target.value)}>
              <option value="lowCoupon">Lowest coupon</option>
              <option value="netYield">Highest net redemption yield</option>
            </select>
          </div>
          {[
            { label: "Maturity window (months before liability)", val: windowMonths, set: setWindowMonths, min: 1, step: 1 },
            { label: "Min nominal increment £", val: increment, set: setIncrement, min: 1, step: 100 },
          ].map(({ label, val, set, min, step }) => (
            <div key={label} style={{ marginBottom: "0.7rem" }}>
              <div style={{ ...s.fieldRow, marginBottom: 3 }}><span>{label}</span></div>
              <input type="number" min={min} step={step} style={s.inputEl} value={val}
                onChange={e => set(e.target.value)} />
            </div>
          ))}
          <div style={{ marginBottom: "0.7rem" }}>
            <div style={{ ...s.fieldRow, marginBottom: 3 }}>
              <span title="Drives accrued interest. Default T+1 business day; UK bank holidays not modelled.">Settlement date ▲</span>
            </div>
            <input type="date" style={s.inputEl} value={settle} onChange={e => setSettle(e.target.value)} />
          </div>
          <div style={{ marginBottom: "0.7rem" }}>
            <div style={{ ...s.fieldRow, marginBottom: 3 }}>
              <span title="Nominal = liability rounded up (coupons are surplus), or size from the longest rung back so coupons received before each liability, held in cash at the cash rate, pay part of it.">Sizing ▲</span>
            </div>
            <select style={s.selectEl} value={sizing} onChange={e => setSizing(e.target.value)}>
              <option value="simple">Redemption covers each liability</option>
              <option value="couponOffset">Net off coupons (buys less)</option>
            </select>
          </div>
          <div style={{ marginBottom: "0.7rem" }}>
            <div style={{ ...s.fieldRow, marginBottom: 3 }}>
              <span title="Liabilities are entered in today's money and grow at this rate to their dates. 0 = fixed nominal amounts.">Inflation % (liabilities in today's £) ▲</span>
            </div>
            <input type="number" min={0} step={0.1} style={s.inputEl} value={inflation}
              onChange={e => setInflation(e.target.value)} />
          </div>
          <div>
            <div style={{ ...s.fieldRow, marginBottom: 3 }}>
              <span title="Used for the cash comparison and for cash held between a coupon or redemption and the liability it pays.">Cash net rate % ▲</span>
            </div>
            <input type="number" min={0} step={0.1} style={s.inputEl} value={cashRate}
              onChange={e => setCashRate(e.target.value)} />
          </div>
        </div>

        <div style={s.sbFoot}>
          Illustrative calculation only — not advice or a recommendation. Prices indicative and may be stale.
          Gilt income is taxable; capital gains on conventional gilts are CGT-exempt for UK individuals.
        </div>
      </SettingsPanel>

      {/* Main */}
      <main className="gt-main">
        {empty && (
          <div style={s.noticeInfo}>
            <span style={{ fontSize: "0.875rem", flexShrink: 0, marginTop: 1 }}>ℹ</span>
            <span>Enter future cash needs below (or use quick-fill). For each one the calculator shows the gilt that matches the
              selection rule and maturity window you set, sized so redemption at par covers the amount, and the resulting cash flows.
              Each rung lists every gilt in its window so you can choose a different one.
              It is an illustration of the arithmetic, not a recommendation to buy any gilt.</span>
          </div>
        )}
        {result.warnings.map((w, i) => (
          <div key={i} style={s.noticeWarn}>
            <span style={{ fontSize: "0.875rem", flexShrink: 0, marginTop: 1 }}>⚠</span><span>{w}</span>
          </div>
        ))}

        {/* Liabilities editor */}
        <div style={s.panel}>
          <div className="gt-panelHdr" style={s.panelHdr}>
            <span style={s.panelTtl}>Liabilities — when you need the money ({rows.length}/{MAX_RUNGS})</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: "0.75rem", color: "var(--text-2)" }}>
              £<input type="number" style={{ ...s.inputEl, width: 90, padding: "4px 7px" }} value={qf.amount}
                onChange={e => setQf(q => ({ ...q, amount: e.target.value }))} />
              per year for
              <input type="number" min={1} max={MAX_RUNGS} style={{ ...s.inputEl, width: 52, padding: "4px 7px" }} value={qf.years}
                onChange={e => setQf(q => ({ ...q, years: e.target.value }))} />
              years starting
              <input type="month" style={{ ...s.inputEl, width: 140, padding: "4px 7px" }} value={qf.start}
                onChange={e => setQf(q => ({ ...q, start: e.target.value }))} />
              <button style={s.btn} onClick={applyQuickFill}>Quick-fill</button>
            </div>
          </div>
          <div style={{ padding: "0.8rem 1rem", display: "flex", flexDirection: "column", gap: 6 }}>
            {rows.map((r, i) => (
              <div key={i} className="gt-liab-row" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="month" style={{ ...s.inputEl, width: 160 }} value={r.date}
                  onChange={e => setRow(i, { date: e.target.value })} />
                <span style={{ fontSize: "0.8125rem", color: "var(--text-2)" }}>£</span>
                <input type="number" min={0} step={1000} style={{ ...s.inputEl, width: 140 }} value={r.amount}
                  onChange={e => setRow(i, { amount: e.target.value })} />
                <button style={{ ...s.btn, padding: "5px 9px", color: "var(--neg)" }} onClick={() => delRow(i)}>✕</button>
              </div>
            ))}
            <div>
              <button style={s.btn} onClick={addRow} disabled={rows.length >= MAX_RUNGS}>+ Add liability</button>
            </div>
          </div>
        </div>

        {!empty && (
          <>
            {/* Summary cards + cash benchmark (§3.5) */}
            <div className="gt-cards" style={s.cards}>
              <div style={s.card}>
                <div style={s.cardLbl}>Total cost today</div>
                <div style={{ ...s.cardVal, color: "var(--text)" }}>{gbp(t.cost)}</div>
                <div style={s.cardSub}>{priceStamp}</div>
              </div>
              <div style={s.card}>
                <div style={s.cardLbl} title="Annual compounding, actual/365.25 — comparable with the annual cash rate.">Portfolio net IRR (annual eff.)</div>
                <div style={{ ...s.cardVal, color: "var(--accent)" }}>{t.portfolioIRR != null ? (t.portfolioIRR * 100).toFixed(3) + "%" : "—"}</div>
                <div style={s.cardSub}>{account !== "GIA" ? "gross — " + account : bands ? `after ${gbp(bands.tax)} band tax on coupons` : `after ${Math.round(taxRate * 100)}% on coupons`}</div>
              </div>
              <div style={s.card}>
                <div style={s.cardLbl} title="Every after-tax coupon and redemption the ladder pays, valued at the cash rate (as if put on deposit until needed), minus what the ladder costs. Positive when the ladder's IRR is above the cash rate you entered. A calculation on your inputs, not a comparison of suitability.">Ladder minus cash at {Number(cashRate).toFixed(1)}% net ▲</div>
                <div style={{ ...s.cardVal, color: "var(--text)" }}>{vsCash >= 0 ? "+" + gbp(vsCash) : "−" + gbp(-vsCash)}</div>
                <div style={s.cardSub} title={`Ladder costs ${gbp(t.cost)}; its inflows are worth ${gbp(t.inflowsPV)} at ${Number(cashRate).toFixed(1)}%, of which ${gbp(t.inflowsPV - t.cashAlternative)} is surplus over the liabilities.`}>
                  cash needs {gbp(t.cashAlternative)}; ladder {gbp(t.ladderNetCost)} net of surplus
                </div>
              </div>
              <div style={s.card}>
                <div style={s.cardLbl}>Weighted avg life</div>
                <div style={{ ...s.cardVal, color: "var(--text)" }}>{t.weightedAvgLife != null ? t.weightedAvgLife.toFixed(1) + "y" : "—"}</div>
                <div style={s.cardSub}>{filled.length} of {result.rungs.length} rungs filled</div>
              </div>
            </div>

            {/* Ladder table (§4.1) */}
            <div style={s.panel}>
              <div className="gt-panelHdr" style={s.panelHdr}>
                <span style={s.panelTtl}>Ladder — {priceStamp}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={s.btn} onClick={() => download("gilt-ladder.csv", toCSV(result), "text/csv")}>⇩ CSV</button>
                  <button style={s.btn} onClick={() => copy("ticket", dealingTicket())}
                    title="Ticker, ISIN and nominal per line, for your own records">{copied === "ticket" ? "✓ Copied" : "Copy summary"}</button>
                  <button style={s.btn} onClick={() => copy("link", window.location.href)}>{copied === "link" ? "✓ Copied" : "Share link"}</button>
                </div>
              </div>
              <div className="gt-tblWrap" style={s.tblWrap}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {[["Need by", 0], ["Liability", 1], ["Gilt", 0], ["EPIC", 0], ["Maturity", 1], ["Coupon", 1], ["Clean £", 1], ["Dirty £", 1], ["Nominal", 1], ["Cost today", 1], ["Net coupons", 1], ["Redemption", 1], ["Net IRR (ann.)", 1]]
                        .map(([h, r]) => <th key={h} style={r ? s.thR : s.th}
                          title={h === "Net IRR (ann.)" ? "Annual effective IRR of the rung's after-tax cash flows (actual/365.25). Selection yields are semi-annual: annual = (1 + y/2)² − 1." : undefined}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rungs.map((r, i) => {
                      if (r.unfillable) return (
                        <tr key={i}>
                          <td style={{ ...s.td }}>{ymLabel(r.liabilityDate)}</td>
                          <td style={{ ...s.tdR, ...s.mono }}>{gbp(r.liability)}</td>
                          <td style={{ ...s.td, color: "var(--neg)" }} colSpan={11}>
                            Unfillable — beyond the longest available gilt; excluded from totals
                          </td>
                        </tr>
                      );
                      return (
                        <Fragment key={i}>
                        <tr className="gt-row">
                          <td style={{ ...s.td }}>{ymLabel(r.liabilityDate)}</td>
                          <td style={{ ...s.tdR, ...s.mono }} title={inflOn ? `${gbp(r.liabilityToday)} in today's money` : undefined}>{gbp(r.liability)}</td>
                          <td style={{ ...s.td }}>
                            {r.gilt.name}
                            {r.gapFilled && <span style={{ ...s.badge, background: "var(--warn-soft)", color: "var(--warn)" }} title={`No gilt within ${windowMonths} months — window widened to ${r.effectiveWindowMonths} months`}>gap-filled</span>}
                            {r.nominal === 0 && <span style={{ ...s.badge, background: "var(--accent-soft)", color: "var(--accent)" }} title="Coupons from longer rungs, held in cash, already cover this liability — nothing to buy.">covered by coupons</span>}
                            {r.exDiv && <span style={{ ...s.badge, background: "var(--info-soft)", color: "var(--info)" }} title="Settlement is in the ex-dividend window: the next coupon goes to the seller; accrued is negative.">ex-div</span>}
                          <div style={{ marginTop: 3, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                            <BrokerLinks gilt={r.gilt} />
                            <button style={{ ...s.editBtn, marginLeft: 0, fontSize: "0.6875rem", padding: "3px 7px", color: "var(--text-2)" }}
                              onClick={() => setListing(k => (k === i ? null : i))}
                              title="See every gilt maturing in this rung's window and choose which one the calculation uses"
                              aria-label={`Show gilts in window for ${ymLabel(r.liabilityDate)}`}>
                              {r.candidates.length} gilt{r.candidates.length > 1 ? "s" : ""} in window {listing === i ? "▴" : "▾"}
                            </button>
                            {r.selectedBy === "user" && <span style={{ ...s.badge, marginLeft: 0, background: "var(--fill)", color: "var(--text-2)" }} title="You chose this gilt for this rung.">your choice</span>}
                          </div>
                          </td>
                          <td style={{ ...s.td, ...s.mono, fontSize: "0.75rem", color: "var(--text-3)" }}>{r.gilt.sym}</td>
                          <td style={{ ...s.tdR, color: "var(--text-3)" }}
                            title={r.idleYears > 0 ? `Redeems ${Math.round(r.idleYears * 365.25)} days before the liability; the cash earns ${gbp(r.idleInterest)} at ${Number(cashRate).toFixed(1)}% meanwhile.` : undefined}>
                            {ymLabel(r.gilt.mat)}
                            {r.idleYears > 0 && r.nominal > 0 && (
                              <div style={{ fontSize: "0.6875rem", lineHeight: 1.3 }}>{r.idleMonths >= 1 ? `${r.idleMonths}m` : `${Math.round(r.idleYears * 365.25)}d`} early · +{gbp(r.idleInterest)}</div>
                            )}
                          </td>
                          <td style={{ ...s.tdR, ...s.mono, color: "var(--text-3)" }}>{r.gilt.c.toFixed(3)}%</td>
                          <td style={{ ...s.tdR, ...s.mono }}>
                            {manual[r.gilt.sym] && (
                              <span style={s.manualBadge}
                                title={`Your price: ${manual[r.gilt.sym].kind} ${manual[r.gilt.sym].input}. Applied as clean ${manual[r.gilt.sym].clean.toFixed(4)} at this ladder's settlement date. One-off — not saved.`}>live</span>
                            )}
                            {r.cleanPx.toFixed(2)}
                            <button style={s.editBtn} onClick={() => setEditing(e => (e === i ? null : i))}
                              title="Enter a live price for this gilt (one-off)" aria-label={`Edit price for ${r.gilt.name}`}>✎</button>
                          </td>
                          <td style={{ ...s.tdR, ...s.mono }}>{r.dirtyPx.toFixed(2)}</td>
                          <td style={{ ...s.tdR, ...s.mono }}>{gbp(r.nominal)}</td>
                          <td style={{ ...s.tdR, ...s.mono, fontWeight: 500 }}>{gbp(r.cost)}</td>
                          <td style={{ ...s.tdR, ...s.mono, color: "var(--accent)" }}>{gbp(r.netCoupons)}</td>
                          <td style={{ ...s.tdR, ...s.mono }}>{gbp(r.nominal)}</td>
                          <td style={{ ...s.tdR }}><strong style={{ ...s.mono, fontSize: "0.8125rem", fontWeight: 500, color: "var(--accent)" }}>{r.netIRR != null ? (r.netIRR * 100).toFixed(3) + "%" : "—"}</strong></td>
                        </tr>
                        {listing === i && (
                          <CandidateList rung={r} colSpan={13}
                            onChoose={sym => setChoices(c => ({ ...c, [isoDay(r.liabilityDate)]: sym }))}
                            onReset={() => setChoices(c => { const { [isoDay(r.liabilityDate)]: _, ...rest } = c; return rest; })}
                            onClose={() => setListing(null)} />
                        )}
                        {editing === i && (
                          <PriceEditor gilt={r.gilt} colSpan={13} taxRate={account === "GIA" ? (bands?.rateAt ?? taxRate) : 0}
                            referenceClean={liveOverrides[r.gilt.sym] ?? r.gilt.px}
                            current={manual[r.gilt.sym] ?? null}
                            note={`The ladder applies your clean price at its settlement date (${isoDay(result.settlement)}), so its dirty price and IRR use accrued interest at that date. Changing the price can change which gilt a rung shows.`}
                            onApply={m => setManual(prev => ({ ...prev, [r.gilt.sym]: m }))}
                            onClear={() => setManual(prev => { const { [r.gilt.sym]: _, ...rest } = prev; return rest; })}
                            onClose={() => setEditing(null)} />
                        )}
                        </Fragment>
                      );
                    })}
                    <tr>
                      <td style={{ ...s.td, background: "var(--fill)", fontWeight: 500 }}>Total</td>
                      <td style={{ ...s.tdR, background: "var(--fill)", ...s.mono, fontWeight: 500 }} title={inflOn ? `${gbp(t.liabilityToday)} in today's money` : undefined}>{gbp(t.liability)}</td>
                      <td style={{ ...s.td, background: "var(--fill)", fontSize: "0.6875rem", color: "var(--text-3)" }} colSpan={6}>
                        weighted average life {t.weightedAvgLife != null ? t.weightedAvgLife.toFixed(1) : "—"}y
                        {inflOn && ` · liabilities grown at ${(t.inflation * 100).toFixed(1)}% a year`}
                        {t.sizing === "couponOffset" && " · sized net of coupons"}
                        {" · "}{priceStamp}
                      </td>
                      <td style={{ ...s.tdR, background: "var(--fill)", ...s.mono, fontWeight: 500 }}>{gbp(t.nominal)}</td>
                      <td style={{ ...s.tdR, background: "var(--fill)", ...s.mono, fontWeight: 500 }}>{gbp(t.cost)}</td>
                      <td style={{ ...s.tdR, background: "var(--fill)", ...s.mono, fontWeight: 500, color: "var(--accent)" }}>{gbp(t.netCoupons)}</td>
                      <td style={{ ...s.tdR, background: "var(--fill)", ...s.mono, fontWeight: 500 }}>{gbp(t.redemption)}</td>
                      <td style={{ ...s.tdR, background: "var(--fill)" }}><strong style={{ ...s.mono, fontSize: "0.8125rem", fontWeight: 500, color: "var(--accent)" }}>{t.portfolioIRR != null ? (t.portfolioIRR * 100).toFixed(3) + "%" : "—"}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Cashflow timeline (§4.2) */}
            {filled.length > 0 && (
              <div style={s.panel}>
                <div className="gt-panelHdr" style={s.panelHdr}><span style={s.panelTtl}>Cashflow timeline</span></div>
                <div style={{ padding: "0.8rem 1rem" }}><CashflowChart result={result} /></div>
              </div>
            )}

            {/* Surplus income note (§4.3) */}
            {filled.length > 0 && Object.keys(result.surplusByTaxYear).length > 0 && (
              <div style={s.panel}>
                <div className="gt-panelHdr" style={s.panelHdr}>
                  <span style={s.panelTtl} title={bands
                    ? "Coupons are taxed as savings income on top of the other income entered: each tax year's taxable interest across the whole ladder goes through the personal allowance, starting rate for savings, personal savings allowance and the rate bands."
                    : "Coupons are savings income; your Personal Savings Allowance and starting rate for savings may cover some of this. Choose 'From other income' under Account & tax to model it."}>
                    {t.sizing === "couponOffset"
                      ? <>Coupon income by tax year ▲ — {account === "GIA" ? "after tax" : "gross"}, used towards the liabilities</>
                      : <>Surplus coupon income by tax year ▲ — {account === "GIA" ? "after tax" : "gross"}, not netted against liabilities</>}
                  </span>
                </div>
                <div style={{ padding: "0.8rem 1rem", display: "flex", flexWrap: "wrap", gap: "0.6rem 1.6rem" }}>
                  {Object.entries(result.surplusByTaxYear).map(([ty, v]) => (
                    <span key={ty} style={{ fontSize: "0.75rem", color: "var(--text-2)" }}>
                      {ty}: <strong style={{ ...s.mono, color: "var(--accent)", fontWeight: 500 }}>{gbp(v)}</strong>
                      {bandYear[ty] && (
                        <span style={{ color: "var(--text-3)" }} title={`${gbp(bandYear[ty].interest)} taxable interest`}>
                          {" "}· tax {gbp(bandYear[ty].tax)} ({(bandYear[ty].rate * 100).toFixed(1)}%)
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
