import { useState, useEffect, useMemo } from "react";
import { MASTER } from "./giltUniverse.js";
import { buildLadder, quickFill, addBusinessDays, toDate } from "./ladderEngine.js";

const MAX_RUNGS = 20;

// ── Styles — mirror GiltTerminal.jsx tokens exactly ──────────────────────────
const s = {
  layout: { display: "grid", gridTemplateColumns: "256px 1fr", flex: 1 },
  sidebar: { background: "#fff", borderRight: "1px solid #e0deda", padding: "1.2rem", display: "flex", flexDirection: "column", gap: "1.1rem", overflowY: "auto" },
  main: { padding: "1.4rem", display: "flex", flexDirection: "column", gap: "1.1rem", overflowY: "auto" },
  secLbl: { fontSize: 10, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9a978f", marginBottom: 6 },
  fieldRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "#5a5750", marginBottom: 4 },
  fieldVal: { fontFamily: "DM Mono, monospace", fontSize: 12, fontWeight: 500, color: "#1a6b4a" },
  selectEl: { background: "#fff", border: "1px solid #e0deda", borderRadius: 6, color: "#1a1916", fontFamily: "'DM Sans', sans-serif", fontSize: 13, padding: "7px 10px", width: "100%", outline: "none" },
  inputEl: { background: "#fff", border: "1px solid #e0deda", borderRadius: 6, color: "#1a1916", fontFamily: "DM Mono, monospace", fontSize: 13, padding: "7px 10px", width: "100%", outline: "none" },
  hr: { border: "none", borderTop: "1px solid #e0deda", margin: "0.1rem 0" },
  sbFoot: { marginTop: "auto", paddingTop: "0.9rem", borderTop: "1px solid #e0deda", fontSize: 11, color: "#9a978f", lineHeight: 1.8 },
  btn: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 13px", borderRadius: 6, fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500, cursor: "pointer", border: "1px solid #e0deda", background: "#fff", color: "#5a5750", whiteSpace: "nowrap" },
  cards: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" },
  card: { background: "#fff", border: "1px solid #e0deda", borderRadius: 6, padding: "0.9rem 1rem", boxShadow: "0 1px 3px rgba(0,0,0,.06)" },
  cardLbl: { fontSize: 11, color: "#9a978f", marginBottom: 3 },
  cardVal: { fontSize: 22, fontWeight: 300, letterSpacing: "-0.02em", lineHeight: 1 },
  cardSub: { fontSize: 11, color: "#9a978f", marginTop: 2 },
  panel: { background: "#fff", border: "1px solid #e0deda", borderRadius: 6, boxShadow: "0 1px 3px rgba(0,0,0,.06)", overflow: "hidden" },
  panelHdr: { padding: "0.65rem 1rem", borderBottom: "1px solid #e0deda", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f2f1ee" },
  panelTtl: { fontSize: 12, fontWeight: 500, color: "#5a5750" },
  tblWrap: { overflowX: "auto" },
  th: { background: "#f2f1ee", padding: "7px 11px", fontSize: 11, fontWeight: 500, letterSpacing: "0.04em", color: "#9a978f", textAlign: "left", borderBottom: "1px solid #e0deda", whiteSpace: "nowrap" },
  thR: { background: "#f2f1ee", padding: "7px 11px", fontSize: 11, fontWeight: 500, letterSpacing: "0.04em", color: "#9a978f", textAlign: "right", borderBottom: "1px solid #e0deda", whiteSpace: "nowrap" },
  td: { padding: "7px 11px", whiteSpace: "nowrap", verticalAlign: "middle", fontSize: 13, borderBottom: "1px solid #e0deda" },
  tdR: { padding: "7px 11px", whiteSpace: "nowrap", verticalAlign: "middle", fontSize: 13, textAlign: "right", borderBottom: "1px solid #e0deda" },
  noticeWarn: { display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", borderRadius: 6, fontSize: 13, lineHeight: 1.6, background: "#fef3e2", color: "#92600a", border: "1px solid rgba(146,96,10,.2)" },
  noticeInfo: { display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", borderRadius: 6, fontSize: 13, lineHeight: 1.6, background: "#e8f0fb", color: "#2563a8", border: "1px solid rgba(37,99,168,.18)" },
  mono: { fontFamily: "DM Mono, monospace" },
  badge: { display: "inline-block", fontSize: 10, fontWeight: 500, padding: "2px 7px", borderRadius: 12, letterSpacing: "0.03em", marginLeft: 6 },
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
          <line x1={x(d)} y1={16} x2={x(d)} y2={mid + 34} stroke="#eae9e5" strokeWidth="1" />
          <text x={x(d)} y={H - 14} fontSize="9" fill="#9a978f" textAnchor="middle" fontFamily="DM Mono, monospace">{d.getUTCFullYear()}</text>
        </g>
      ))}
      <line x1={PAD} y1={mid} x2={W - PAD} y2={mid} stroke="#c0bdb7" strokeWidth="1" />
      {/* outflow at settlement */}
      <rect x={x(t0) - 3} y={mid} width="6" height={yUp(cost) * 0.4 + 8} fill="#b91c1c" rx="1">
        <title>{`Settlement ${isoDay(t0)}: −${gbp(cost)}`}</title>
      </rect>
      {/* coupons + redemptions */}
      {flows.map((f, i) => (
        <rect key={i} x={x(f.date) - (f.kind === "redemption" ? 3 : 1)} y={mid - yUp(f.v)}
          width={f.kind === "redemption" ? 6 : 2} height={yUp(f.v)}
          fill={f.kind === "redemption" ? "#1a6b4a" : "#7fb8a0"} rx="1">
          <title>{`${isoDay(toDate(f.date))}: +${gbp(f.v)} ${f.kind}`}</title>
        </rect>
      ))}
      {/* liability markers */}
      {filled.map((r, i) => (
        <g key={i} transform={`translate(${x(r.liabilityDate)}, ${mid + 16})`}>
          <path d="M0 -5 L5 0 L0 5 L-5 0 Z" fill="none" stroke="#2563a8" strokeWidth="1.5">
            <title>{`Liability ${ymLabel(r.liabilityDate)}: ${gbp(r.liability)}`}</title>
          </path>
        </g>
      ))}
      <text x={PAD} y={12} fontSize="9" fill="#9a978f" fontFamily="DM Mono, monospace">inflows ↑ (coupons light, redemptions dark) · outflow ↓ red · liabilities ◇</text>
    </svg>
  );
}

// ── Exports (§4.4) ────────────────────────────────────────────────────────────
function toCSV(result) {
  const head = ["Rung date", "Liability GBP", "Gilt", "EPIC", "Maturity", "Coupon %", "Clean", "Dirty", "Nominal GBP", "Cost GBP", "Net coupons GBP", "Redemption GBP", "Net IRR %", "Flags"];
  const rows = result.rungs.map(r => r.unfillable
    ? [ymLabel(r.liabilityDate), r.liability, "UNFILLABLE", "", "", "", "", "", "", "", "", "", "", "unfillable"]
    : [ymLabel(r.liabilityDate), r.liability, r.gilt.name, r.gilt.sym, r.gilt.mat, r.gilt.c,
       r.cleanPx.toFixed(2), r.dirtyPx.toFixed(4), r.nominal, r.cost.toFixed(2),
       r.netCoupons.toFixed(2), r.nominal, r.netIRR != null ? (r.netIRR * 100).toFixed(3) : "",
       [r.gapFilled && "gap-filled", r.exDiv && "ex-div"].filter(Boolean).join(" ")]);
  const t = result.totals;
  rows.push(["TOTAL", t.liability, "", "", "", "", "", "", t.nominal, t.cost.toFixed(2), t.netCoupons.toFixed(2), t.redemption,
    t.portfolioIRR != null ? (t.portfolioIRR * 100).toFixed(3) : "", `WAL ${t.weightedAvgLife?.toFixed(1)}y`]);
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
export default function LadderView({ taxRate, setTaxRate, liveOverrides, isLive, asOf }) {
  const saved = useMemo(readHash, []);
  const [rows, setRows] = useState(saved?.rows ?? defaultLiabilities());
  const [account, setAccount] = useState(saved?.account ?? "GIA");
  const [pref, setPref] = useState(saved?.pref ?? "lowCoupon");
  const [windowMonths, setWindowMonths] = useState(saved?.w ?? 12);
  const [increment, setIncrement] = useState(saved?.inc ?? 100);
  const [settle, setSettle] = useState(saved?.settle ?? isoDay(addBusinessDays(new Date(), 1)));
  const [cashRate, setCashRate] = useState(saved?.cash ?? 3.0);
  const [qf, setQf] = useState({ amount: 50000, years: 3, start: defaultLiabilities()[0].date });
  const [copied, setCopied] = useState(null);

  const inputs = useMemo(
    () => ({ rows, account, pref, w: windowMonths, inc: increment, settle, cash: cashRate, taxRate }),
    [rows, account, pref, windowMonths, increment, settle, cashRate, taxRate]
  );
  const dIn = useDebounced(inputs, 250); // §5: recompute debounced 250ms

  useEffect(() => {
    const { taxRate: _t, ...toSave } = dIn;
    writeHash(toSave);
  }, [dIn]);

  const result = useMemo(() => buildLadder({
    liabilities: dIn.rows,
    accountType: dIn.account,
    taxRate: dIn.taxRate,
    preference: dIn.pref,
    windowMonths: Number(dIn.w) || 12,
    settlement: dIn.settle,
    universe: MASTER,
    prices: liveOverrides,
    incrementGBP: Math.max(1, Number(dIn.inc) || 100),
    cashNetRate: (Number(dIn.cash) || 3) / 100,
  }), [dIn, liveOverrides]);

  const t = result.totals;
  const filled = result.rungs.filter(r => !r.unfillable);
  const vsCash = t.cashAlternative - t.cost;
  const priceStamp = isLive && asOf ? `Prices as of ${asOf}` : "Prices: snapshot 31 Mar 2026 (fallback)";

  const setRow = (i, patch) => setRows(rs => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows(rs => rs.length >= MAX_RUNGS ? rs : [...rs, { date: rs.at(-1)?.date ?? defaultLiabilities()[0].date, amount: 50000 }]);
  const delRow = i => setRows(rs => rs.filter((_, k) => k !== i));
  const applyQuickFill = () => setRows(quickFill(Number(qf.amount) || 0, Math.min(MAX_RUNGS, Number(qf.years) || 1), qf.start));

  const copy = (label, text) => navigator.clipboard.writeText(text).then(() => {
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  });
  const dealingTicket = () => filled.map(r => `${r.gilt.sym} — nominal ${gbp(r.nominal)} — buy`).join("\n");

  const empty = rows.filter(r => Number(r.amount) > 0).length === 0;

  return (
    <div style={s.layout}>
      {/* Sidebar — ladder inputs (§2) */}
      <aside style={s.sidebar}>
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
          {account === "GIA" && (
            <div style={{ marginBottom: "0.7rem" }}>
              <div style={s.fieldRow}>
                <span>Income tax rate</span>
                <span style={s.fieldVal}>{Math.round(taxRate * 100)}%</span>
              </div>
              <input type="range" min={0} max={60} step={5} value={Math.round(taxRate * 100)}
                onChange={e => setTaxRate(parseInt(e.target.value) / 100)}
                style={{ width: "100%", height: 3, accentColor: "#1a6b4a", cursor: "pointer" }} />
            </div>
          )}
        </div>

        <hr style={s.hr} />

        <div>
          <div style={s.secLbl}>Ladder settings</div>
          <div style={{ marginBottom: "0.7rem" }}>
            <div style={{ ...s.fieldRow, marginBottom: 3 }}><span>Selection preference</span></div>
            <select style={s.selectEl} value={pref} onChange={e => setPref(e.target.value)}>
              <option value="lowCoupon">Lowest coupon (min tax drag)</option>
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
          <div>
            <div style={{ ...s.fieldRow, marginBottom: 3 }}><span>Cash alternative net rate %</span></div>
            <input type="number" min={0} step={0.1} style={s.inputEl} value={cashRate}
              onChange={e => setCashRate(e.target.value)} />
          </div>
        </div>

        <div style={s.sbFoot}>
          Illustrative only — not investment advice. Prices indicative and may be stale.
          Gilt income is taxable; capital gains on conventional gilts are CGT-exempt for UK individuals.
        </div>
      </aside>

      {/* Main */}
      <main style={s.main}>
        {empty && (
          <div style={s.noticeInfo}>
            <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>ℹ</span>
            <span>Enter your future spending needs below (or use quick-fill) and the ladder builder
              picks a gilt maturing just before each one, sized so redemption at par meets the bill — coupons along the way are surplus.</span>
          </div>
        )}
        {result.warnings.map((w, i) => (
          <div key={i} style={s.noticeWarn}>
            <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>⚠</span><span>{w}</span>
          </div>
        ))}

        {/* Liabilities editor */}
        <div style={s.panel}>
          <div style={s.panelHdr}>
            <span style={s.panelTtl}>Liabilities — when you need the money ({rows.length}/{MAX_RUNGS})</span>
            <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "#5a5750" }}>
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
              <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="month" style={{ ...s.inputEl, width: 160 }} value={r.date}
                  onChange={e => setRow(i, { date: e.target.value })} />
                <span style={{ fontSize: 13, color: "#5a5750" }}>£</span>
                <input type="number" min={0} step={1000} style={{ ...s.inputEl, width: 140 }} value={r.amount}
                  onChange={e => setRow(i, { amount: e.target.value })} />
                <button style={{ ...s.btn, padding: "5px 9px", color: "#b91c1c" }} onClick={() => delRow(i)}>✕</button>
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
            <div style={s.cards}>
              <div style={s.card}>
                <div style={s.cardLbl}>Total cost today</div>
                <div style={{ ...s.cardVal, color: "#1a1916" }}>{gbp(t.cost)}</div>
                <div style={s.cardSub}>{priceStamp}</div>
              </div>
              <div style={s.card}>
                <div style={s.cardLbl}>Portfolio net IRR</div>
                <div style={{ ...s.cardVal, color: "#1a6b4a" }}>{t.portfolioIRR != null ? (t.portfolioIRR * 100).toFixed(3) + "%" : "—"}</div>
                <div style={s.cardSub}>{account === "GIA" ? `after ${Math.round(taxRate * 100)}% on coupons` : "gross — " + account}</div>
              </div>
              <div style={s.card}>
                <div style={s.cardLbl}>vs cash at {Number(cashRate).toFixed(1)}% net</div>
                <div style={{ ...s.cardVal, color: vsCash >= 0 ? "#1a6b4a" : "#b91c1c" }}>{vsCash >= 0 ? gbp(vsCash) + " less" : gbp(-vsCash) + " more"}</div>
                <div style={s.cardSub}>cash needs {gbp(t.cashAlternative)}; the ladder locks these payouts in today — no reinvestment-rate risk</div>
              </div>
              <div style={s.card}>
                <div style={s.cardLbl}>Weighted avg life</div>
                <div style={{ ...s.cardVal, color: "#1a1916" }}>{t.weightedAvgLife != null ? t.weightedAvgLife.toFixed(1) + "y" : "—"}</div>
                <div style={s.cardSub}>{filled.length} of {result.rungs.length} rungs filled</div>
              </div>
            </div>

            {/* Ladder table (§4.1) */}
            <div style={s.panel}>
              <div style={s.panelHdr}>
                <span style={s.panelTtl}>Ladder — {priceStamp}</span>
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={s.btn} onClick={() => download("gilt-ladder.csv", toCSV(result), "text/csv")}>⇩ CSV</button>
                  <button style={s.btn} onClick={() => copy("ticket", dealingTicket())}
                    title="EPIC ticker per line (ISINs not in the data layer)">{copied === "ticket" ? "✓ Copied" : "Copy dealing ticket"}</button>
                  <button style={s.btn} onClick={() => copy("link", window.location.href)}>{copied === "link" ? "✓ Copied" : "Share link"}</button>
                </div>
              </div>
              <div style={s.tblWrap}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      {[["Need by", 0], ["Liability", 1], ["Gilt", 0], ["EPIC", 0], ["Maturity", 1], ["Coupon", 1], ["Clean £", 1], ["Dirty £", 1], ["Nominal", 1], ["Cost today", 1], ["Net coupons", 1], ["Redemption", 1], ["Net IRR", 1]]
                        .map(([h, r]) => <th key={h} style={r ? s.thR : s.th}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rungs.map((r, i) => {
                      const bg = i % 2 === 0 ? "#fff" : "#fafaf9";
                      if (r.unfillable) return (
                        <tr key={i}>
                          <td style={{ ...s.td, background: bg }}>{ymLabel(r.liabilityDate)}</td>
                          <td style={{ ...s.tdR, background: bg, ...s.mono }}>{gbp(r.liability)}</td>
                          <td style={{ ...s.td, background: bg, color: "#b91c1c" }} colSpan={11}>
                            Unfillable — beyond the longest available gilt; excluded from totals
                          </td>
                        </tr>
                      );
                      return (
                        <tr key={i}>
                          <td style={{ ...s.td, background: bg }}>{ymLabel(r.liabilityDate)}</td>
                          <td style={{ ...s.tdR, background: bg, ...s.mono }}>{gbp(r.liability)}</td>
                          <td style={{ ...s.td, background: bg }}>
                            {r.gilt.name}
                            {r.gapFilled && <span style={{ ...s.badge, background: "#fef3e2", color: "#92600a" }} title={`No gilt within ${windowMonths} months — window widened to ${r.effectiveWindowMonths} months`}>gap-filled</span>}
                            {r.exDiv && <span style={{ ...s.badge, background: "#e8f0fb", color: "#2563a8" }} title="Settlement is in the ex-dividend window: the next coupon goes to the seller; accrued is negative.">ex-div</span>}
                          </td>
                          <td style={{ ...s.td, background: bg, ...s.mono, fontSize: 12, color: "#9a978f" }}>{r.gilt.sym}</td>
                          <td style={{ ...s.tdR, background: bg, color: "#9a978f" }}>{ymLabel(r.gilt.mat)}</td>
                          <td style={{ ...s.tdR, background: bg, ...s.mono, color: "#9a978f" }}>{r.gilt.c.toFixed(3)}%</td>
                          <td style={{ ...s.tdR, background: bg, ...s.mono }}>{r.cleanPx.toFixed(2)}</td>
                          <td style={{ ...s.tdR, background: bg, ...s.mono }}>{r.dirtyPx.toFixed(2)}</td>
                          <td style={{ ...s.tdR, background: bg, ...s.mono }}>{gbp(r.nominal)}</td>
                          <td style={{ ...s.tdR, background: bg, ...s.mono, fontWeight: 500 }}>{gbp(r.cost)}</td>
                          <td style={{ ...s.tdR, background: bg, ...s.mono, color: "#1a6b4a" }}>{gbp(r.netCoupons)}</td>
                          <td style={{ ...s.tdR, background: bg, ...s.mono }}>{gbp(r.nominal)}</td>
                          <td style={{ ...s.tdR, background: bg }}><strong style={{ ...s.mono, fontSize: 13, fontWeight: 500, color: "#1a6b4a" }}>{r.netIRR != null ? (r.netIRR * 100).toFixed(3) + "%" : "—"}</strong></td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td style={{ ...s.td, background: "#f2f1ee", fontWeight: 500 }}>Total</td>
                      <td style={{ ...s.tdR, background: "#f2f1ee", ...s.mono, fontWeight: 500 }}>{gbp(t.liability)}</td>
                      <td style={{ ...s.td, background: "#f2f1ee", fontSize: 11, color: "#9a978f" }} colSpan={6}>
                        weighted average life {t.weightedAvgLife != null ? t.weightedAvgLife.toFixed(1) : "—"}y · {priceStamp}
                      </td>
                      <td style={{ ...s.tdR, background: "#f2f1ee", ...s.mono, fontWeight: 500 }}>{gbp(t.nominal)}</td>
                      <td style={{ ...s.tdR, background: "#f2f1ee", ...s.mono, fontWeight: 500 }}>{gbp(t.cost)}</td>
                      <td style={{ ...s.tdR, background: "#f2f1ee", ...s.mono, fontWeight: 500, color: "#1a6b4a" }}>{gbp(t.netCoupons)}</td>
                      <td style={{ ...s.tdR, background: "#f2f1ee", ...s.mono, fontWeight: 500 }}>{gbp(t.redemption)}</td>
                      <td style={{ ...s.tdR, background: "#f2f1ee" }}><strong style={{ ...s.mono, fontSize: 13, fontWeight: 500, color: "#1a6b4a" }}>{t.portfolioIRR != null ? (t.portfolioIRR * 100).toFixed(3) + "%" : "—"}</strong></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Cashflow timeline (§4.2) */}
            {filled.length > 0 && (
              <div style={s.panel}>
                <div style={s.panelHdr}><span style={s.panelTtl}>Cashflow timeline</span></div>
                <div style={{ padding: "0.8rem 1rem" }}><CashflowChart result={result} /></div>
              </div>
            )}

            {/* Surplus income note (§4.3) */}
            {filled.length > 0 && Object.keys(result.surplusByTaxYear).length > 0 && (
              <div style={s.panel}>
                <div style={s.panelHdr}>
                  <span style={s.panelTtl} title="Coupons are savings income; your Personal Savings Allowance and starting rate for savings may cover some of this. Not modelled here.">
                    Surplus coupon income by tax year ▲ — {account === "GIA" ? "after tax" : "gross"}, not netted against liabilities
                  </span>
                </div>
                <div style={{ padding: "0.8rem 1rem", display: "flex", flexWrap: "wrap", gap: "0.6rem 1.6rem" }}>
                  {Object.entries(result.surplusByTaxYear).map(([ty, v]) => (
                    <span key={ty} style={{ fontSize: 12, color: "#5a5750" }}>
                      {ty}: <strong style={{ ...s.mono, color: "#1a6b4a", fontWeight: 500 }}>{gbp(v)}</strong>
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
