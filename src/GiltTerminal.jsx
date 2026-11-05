import { useState, useEffect, useCallback, useMemo } from "react";
import { settlementTerms, solveYTM, priceSettlement } from "./giltMath.js";
import { MASTER } from "./giltUniverse.js";
import LadderView from "./LadderView.jsx";

// ── Constants ────────────────────────────────────────────────────────────────

const PRICES_URL_DEFAULT = "/gilt-prices.json";
const STALE_DAYS_WARN = 4;


// ── Maths ─────────────────────────────────────────────────────────────────────


/**
 * Deposit-equivalent yield: the gross yield a fully-taxable instrument would
 * need to offer to match this gilt's after-tax return.
 *
 * Formula: atYTM / (1 - taxRate)
 */
function calcGEY(coupon, cleanPx, atYTM, taxRate) {
  if (taxRate === 0) return atYTM;
  return atYTM / (1 - taxRate);
}

function getTenor(matStr, settlement) {
  const y = (new Date(matStr) - settlement) / (365.25 * 86400000);
  return y <= 5 ? "short" : y <= 15 ? "medium" : "long";
}

// `settlement`: accrued interest and yields are computed for T+1 settlement
// after the price date (priceSettlement), not for the moment the page loaded.
// `liveDirty`: DMO dirty prices for exactly this settlement date ({} if none);
// when present, accrued = dirty − clean instead of being computed.
function processGilts(liveOverrides, isLive, taxRate, settlement, liveDirty = {}) {
  return MASTER.filter(g => new Date(g.mat) > settlement).map(g => {
    const cp = liveOverrides[g.sym] ?? g.px;
    // Accrued interest at settlement, negative inside the ex-dividend window
    // (the buyer forgoes the next coupon; solveYTM then excludes it).
    const terms = settlementTerms(g.c, g.mat, settlement);
    const dmoDirty = isLive ? liveDirty[g.sym] : undefined;
    const ai = !isLive ? g.ai
      : Number.isFinite(dmoDirty) ? dmoDirty - cp
      : terms.ai;

    // Gross YTM: solveYTM with taxRate=0 when live prices available,
    // else use the snapshot value from MASTER (already correct for that date).
    // null = no yield in range reprices the gilt; shown as "—" with a warning,
    // never replaced by a stale or boundary value.
    const grossYTM = isLive
      ? solveYTM(g.c, g.mat, cp, ai, 0, settlement)
      : g.gy;

    const at = taxRate === 0
      ? grossYTM
      : solveYTM(g.c, g.mat, cp, ai, taxRate, settlement);

    const gey  = at != null ? calcGEY(g.c, cp, at, taxRate) : null;
    const drag = at != null && grossYTM != null ? grossYTM - at : null;
    const yrs  = (new Date(g.mat) - settlement) / (365.25 * 86400000);

    return {
      ...g, cp, ai, exDiv: terms.exDiv, grossYTM, at, gey, drag, yrs,
      tenor: getTenor(g.mat, settlement),
      couponType: g.c <= 2 ? "low" : "high",
      dPx: cp - g.px,
    };
  });
}

// Sort with unsolvable (null) values always last, whatever the direction.
const nullsLast = (key, cmp) => (a, b) =>
  a[key] == null ? (b[key] == null ? 0 : 1) : b[key] == null ? -1 : cmp(a, b);

function applyFilters(data, { matFilter, couponFilter, sortBy }) {
  let d = [...data];
  if (matFilter !== "all") d = d.filter(g => g.tenor === matFilter);
  if (couponFilter !== "all") d = d.filter(g => g.couponType === couponFilter);
  const sorts = {
    atYTM:    nullsLast("at", (a, b) => b.at - a.at),
    grossYTM: nullsLast("grossYTM", (a, b) => b.grossYTM - a.grossYTM),
    taxDrag:  nullsLast("drag", (a, b) => a.drag - b.drag),
    maturity: (a, b) => new Date(a.mat) - new Date(b.mat),
    cleanPx:  (a, b) => a.cp - b.cp,
  };
  return d.sort(sorts[sortBy] ?? sorts.atYTM);
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = {
  wrap: { display: "flex", flexDirection: "column", minHeight: "100vh", background: "#f7f6f3", fontFamily: "'DM Sans', sans-serif", fontSize: 14, color: "#1a1916" },
  header: { background: "#fff", borderBottom: "1px solid #e0deda", padding: "0 1.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", height: 56, position: "sticky", top: 0, zIndex: 100, boxShadow: "0 1px 3px rgba(0,0,0,.06)" },
  logoWrap: { display: "flex", alignItems: "center", gap: 10 },
  logoMark: { width: 30, height: 30, background: "#1a6b4a", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: "DM Mono, monospace", fontSize: 11, fontWeight: 500 },
  logoText: { fontSize: 15, fontWeight: 500, letterSpacing: "-0.01em" },
  logoSub: { fontSize: 12, color: "#9a978f", marginLeft: 4 },
  hdrRight: { display: "flex", alignItems: "center", gap: 10 },
  livePill: { display: "flex", alignItems: "center", gap: 5, background: "#e8f5ef", color: "#1a6b4a", padding: "4px 10px", borderRadius: 20, fontSize: 11, fontWeight: 500 },
  stamp: { fontSize: 11, color: "#9a978f" },
  layout: { display: "grid", gridTemplateColumns: "256px 1fr", flex: 1 },
  sidebar: { background: "#fff", borderRight: "1px solid #e0deda", padding: "1.2rem", display: "flex", flexDirection: "column", gap: "1.1rem", overflowY: "auto" },
  main: { padding: "1.4rem", display: "flex", flexDirection: "column", gap: "1.1rem", overflowY: "auto" },
  secLbl: { fontSize: 10, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9a978f", marginBottom: 6 },
  fieldRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "#5a5750", marginBottom: 4 },
  fieldVal: { fontFamily: "DM Mono, monospace", fontSize: 12, fontWeight: 500, color: "#1a6b4a" },
  selectEl: { background: "#fff", border: "1px solid #e0deda", borderRadius: 6, color: "#1a1916", fontFamily: "'DM Sans', sans-serif", fontSize: 13, padding: "7px 10px", width: "100%", outline: "none" },
  hr: { border: "none", borderTop: "1px solid #e0deda", margin: "0.1rem 0" },
  sbFoot: { marginTop: "auto", paddingTop: "0.9rem", borderTop: "1px solid #e0deda", fontSize: 11, color: "#9a978f", lineHeight: 1.8 },
  btnRefresh: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 13px", borderRadius: 6, fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500, cursor: "pointer", border: "1px solid #e0deda", background: "#fff", color: "#5a5750", whiteSpace: "nowrap" },
  cards: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" },
  card: { background: "#fff", border: "1px solid #e0deda", borderRadius: 6, padding: "0.9rem 1rem", boxShadow: "0 1px 3px rgba(0,0,0,.06)" },
  cardLbl: { fontSize: 11, color: "#9a978f", marginBottom: 3 },
  cardVal: { fontSize: 22, fontWeight: 300, letterSpacing: "-0.02em", lineHeight: 1 },
  cardSub: { fontSize: 11, color: "#9a978f", marginTop: 2 },
  panel: { background: "#fff", border: "1px solid #e0deda", borderRadius: 6, boxShadow: "0 1px 3px rgba(0,0,0,.06)", overflow: "hidden" },
  panelHdr: { padding: "0.65rem 1rem", borderBottom: "1px solid #e0deda", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f2f1ee" },
  panelTtl: { fontSize: 12, fontWeight: 500, color: "#5a5750" },
  pills: { display: "flex", gap: 4 },
  pill: { fontSize: 11, padding: "3px 9px", borderRadius: 20, border: "1px solid #e0deda", color: "#9a978f", background: "#fff", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  pillOn: { fontSize: 11, padding: "3px 9px", borderRadius: 20, border: "1px solid rgba(26,107,74,.18)", color: "#1a6b4a", background: "#e8f5ef", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 },
  tblWrap: { overflowX: "auto" },
  th: { background: "#f2f1ee", padding: "7px 11px", fontSize: 11, fontWeight: 500, letterSpacing: "0.04em", color: "#9a978f", textAlign: "left", borderBottom: "1px solid #e0deda", whiteSpace: "nowrap" },
  thR: { background: "#f2f1ee", padding: "7px 11px", fontSize: 11, fontWeight: 500, letterSpacing: "0.04em", color: "#9a978f", textAlign: "right", borderBottom: "1px solid #e0deda", whiteSpace: "nowrap" },
  tdBase: { padding: "7px 11px", whiteSpace: "nowrap", verticalAlign: "middle", fontSize: 13, borderBottom: "1px solid #e0deda" },
  tdR: { padding: "7px 11px", whiteSpace: "nowrap", verticalAlign: "middle", fontSize: 13, textAlign: "right", borderBottom: "1px solid #e0deda" },
  ts: { display: "flex", justifyContent: "space-between", padding: "5px 11px", background: "#f2f1ee", borderTop: "1px solid #e0deda", fontSize: 11, color: "#9a978f" },
  noticeInfo: { display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", borderRadius: 6, fontSize: 13, lineHeight: 1.6, background: "#e8f0fb", color: "#2563a8", border: "1px solid rgba(37,99,168,.18)" },
  noticeWarn: { display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", borderRadius: 6, fontSize: 13, lineHeight: 1.6, background: "#fef3e2", color: "#92600a", border: "1px solid rgba(146,96,10,.2)" },
  noticeOk:   { display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", borderRadius: 6, fontSize: 13, lineHeight: 1.6, background: "#e8f5ef", color: "#1a6b4a", border: "1px solid rgba(26,107,74,.18)" },
  // Methodology tooltip
  methodBox: { background: "#f2f1ee", border: "1px solid #e0deda", borderRadius: 6, padding: "0.9rem 1rem", fontSize: 12, color: "#5a5750", lineHeight: 1.75 },
};

// ── Sub-components ────────────────────────────────────────────────────────────
function LiveDot() {
  return <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#1a6b4a", display: "inline-block", animation: "blink 2s ease-in-out infinite" }} />;
}

function Notice({ type, children, onDismiss }) {
  const st = type === "warn" ? s.noticeWarn : type === "ok" ? s.noticeOk : s.noticeInfo;
  const icons = { info: "ℹ", warn: "⚠", ok: "✓" };
  return (
    <div style={st}>
      <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{icons[type]}</span>
      <span style={{ flex: 1 }}>{children}</span>
      {onDismiss && <span style={{ cursor: "pointer", opacity: 0.6, marginLeft: 8 }} onClick={onDismiss}>✕</span>}
    </div>
  );
}

function SummaryCards({ data, taxRate }) {
  const solved = data.filter(g => g.at != null && g.drag != null);
  const best = solved.reduce((b, g) => (!b || g.at > b.at ? g : b), null);
  const avgDrag = solved.length ? solved.reduce((s, g) => s + g.drag, 0) / solved.length : 0;
  return (
    <div style={s.cards}>
      <div style={s.card}>
        <div style={s.cardLbl}>Gilts shown</div>
        <div style={{ ...s.cardVal, color: "#1a6b4a" }}>{data.length}</div>
        <div style={s.cardSub}>conventional gilts</div>
      </div>
      <div style={s.card}>
        <div style={s.cardLbl}>Best after-tax YTM</div>
        <div style={{ ...s.cardVal, color: "#1a6b4a" }}>{best ? best.at.toFixed(3) + "%" : "—"}</div>
        <div style={{ ...s.cardSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{best ? best.name.replace(" Treasury", "").replace(" Stock", "").trim() : "—"}</div>
      </div>
      <div style={s.card}>
        <div style={s.cardLbl}>Avg tax drag</div>
        <div style={{ ...s.cardVal, color: "#b91c1c" }}>{solved.length ? `-${avgDrag.toFixed(2)}%` : "—"}</div>
        <div style={s.cardSub}>gross minus after-tax</div>
      </div>
      <div style={s.card}>
        <div style={s.cardLbl}>Tax rate applied</div>
        <div style={{ ...s.cardVal, color: "#1a6b4a" }}>{Math.round(taxRate * 100)}%</div>
        <div style={s.cardSub}>coupons taxable; gains exempt</div>
      </div>
    </div>
  );
}

function GiltTable({ data, isLive }) {
  const solvedAt = data.filter(g => g.at != null).map(g => g.at);
  const maxAt = solvedAt.length ? Math.max(...solvedAt) : 1;
  const unsolved = data.filter(g => g.at == null || g.grossYTM == null);
  const pctFmt = v => (v == null ? "—" : v.toFixed(3) + "%");
  const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div style={s.panel}>
      <div style={s.tblWrap}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {[
                ["#",                false],
                ["Gilt",             false],
                ["Coupon",           true],
                ["Maturity",         true],
                ["Tenor",            true],
                ["Clean £",          true],
                ["Δ Price",          true],
                ["Gross YTM (s.a.)",     true],
                ["After-Tax YTM (s.a.)", true],
                ["Deposit Equiv. ▲", true], // renamed + tooltip
                ["Tax Drag",         true],
                ["Type",             true],
                ["Relative",         true],
              ].map(([h, right]) => (
                <th key={h} style={right ? s.thR : s.th} title={
                  h === "Deposit Equiv. ▲"
                    ? "Gross yield a fully-taxable deposit/bond would need to match this gilt's after-tax return. Formula: after-tax YTM + (coupon/price) × tax rate. Accurate for low-coupon gilts; slightly understates for high-coupon gilts."
                    : h.endsWith("(s.a.)")
                    ? "Semi-annual compounding, DMO convention. Annual effective = (1 + y/2)² − 1."
                    : undefined
                }>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {unsolved.length > 0 && (
              <tr>
                <td colSpan={13} style={{ ...s.tdBase, background: "#fef3e2", color: "#92600a", fontSize: 12 }}>
                  ⚠ No yield between −50% and 100% reprices {unsolved.map(g => g.sym).join(", ")} at the
                  current price and accrued interest — shown as "—". Check the price before relying on it.
                </td>
              </tr>
            )}
            {data.map((g, i) => {
              const isTop = i === 0;
              const rowBg = isTop ? "#e8f5ef" : i % 2 === 0 ? "#fff" : "#fafaf9";
              const matLbl = new Date(g.mat).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
              const pct = g.at != null ? Math.max(0, (g.at / maxAt) * 100).toFixed(1) : "0";
              const dPxCls = g.dPx > 0.005 ? "#1a6b4a" : g.dPx < -0.005 ? "#b91c1c" : "#9a978f";
              const dPxTxt = isLive ? (g.dPx > 0.005 ? `+${g.dPx.toFixed(2)}` : g.dPx < -0.005 ? g.dPx.toFixed(2) : "—") : "—";
              const td = (content, right = false, extra = {}) => (
                <td style={{ ...(right ? s.tdR : s.tdBase), background: rowBg, ...extra }}>{content}</td>
              );
              return (
                <tr key={g.sym}>
                  {td(<span style={{ fontFamily: "DM Mono, monospace", fontSize: 11, color: isTop ? "#1a6b4a" : "#9a978f", fontWeight: isTop ? 500 : 400 }}>{i + 1}</span>)}
                  {td(<span style={{ fontSize: 13, color: "#1a1916", maxWidth: 195, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{g.name}</span>)}
                  {td(<span style={{ fontFamily: "DM Mono, monospace", color: "#9a978f" }}>{g.c.toFixed(3)}%</span>, true)}
                  {td(<span style={{ color: "#9a978f" }}>{matLbl}</span>, true)}
                  {td(<span style={{ color: "#9a978f", fontSize: 12 }}>{g.yrs.toFixed(1)}y</span>, true)}
                  {td(<span style={{ fontFamily: "DM Mono, monospace" }}>£{g.cp.toFixed(2)}</span>, true)}
                  {td(<span style={{ fontFamily: "DM Mono, monospace", fontSize: 11, color: dPxCls }}>{dPxTxt}</span>, true)}
                  {td(<span style={{ fontFamily: "DM Mono, monospace", fontSize: 12, color: "#9a978f" }}>{pctFmt(g.grossYTM)}</span>, true)}
                  {td(<strong style={{ fontFamily: "DM Mono, monospace", fontSize: 14, fontWeight: 500, color: "#1a6b4a" }}>{pctFmt(g.at)}</strong>, true)}
                  {td(<strong style={{ fontFamily: "DM Mono, monospace", fontSize: 13, fontWeight: 500, color: "#2563a8" }}>{pctFmt(g.gey)}</strong>, true)}
                  {td(<span style={{ fontFamily: "DM Mono, monospace", fontSize: 12, color: "#b91c1c" }}>{g.drag == null ? "—" : `-${g.drag.toFixed(2)}%`}</span>, true)}
                  {td(
                    <span style={{ display: "inline-block", fontSize: 10, fontWeight: 500, padding: "2px 7px", borderRadius: 12, letterSpacing: "0.03em", ...(g.couponType === "low" ? { background: "#e8f0fb", color: "#2563a8" } : { background: "#fef3e2", color: "#92600a" }) }}>
                      {g.couponType}
                    </span>, true
                  )}
                  {td(
                    <div style={{ width: 60 }}>
                      <div style={{ background: "#eae9e5", height: 3, borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: "#1a6b4a", borderRadius: 2 }} />
                      </div>
                    </div>, true
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={s.ts}>
        <span>{isLive ? "⬤ Live · UK DMO daily reference prices" : "◯ Cached · snapshot 31 Mar 2026"}</span>
        <span>{now}</span>
      </div>
    </div>
  );
}

// ── Methodology note ──────────────────────────────────────────────────────────
function MethodologyNote({ taxRate, settlement }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ ...s.btnRefresh, fontSize: 11, padding: "5px 11px", color: "#9a978f" }}
      >
        {open ? "▲" : "▼"} Methodology
      </button>
      {open && (
        <div style={{ ...s.methodBox, marginTop: 8 }}>
          <strong style={{ color: "#1a1916" }}>After-tax YTM</strong> — solved by bisection on the IRR of
          after-tax cash flows using the exact future coupon schedule. Following the DMO yield
          formula, cash flows are discounted in coupon periods (days to next coupon ÷ days in the
          current period, then whole half-years) with semi-annual compounding, so gross YTM is
          comparable with DMO and Bloomberg yields. Yields are semi-annual (s.a.); the
          annual-effective equivalent is (1 + y/2)² − 1.
          Coupon income is taxed at {Math.round(taxRate * 100)}%; the redemption gain (£100 − clean price) is
          CGT-exempt under TCGA 1992 s.115. Accrued income scheme: on a cum-dividend purchase
          only the portion of the first coupon accruing <em>after</em> purchase is taxed (relief
          for the accrued interest paid); on an ex-dividend purchase the next coupon goes to the
          seller and the buyer is taxed on the rebate interest (HMRC SAIM4150).
          <br /><br />
          <strong style={{ color: "#1a1916" }}>Settlement</strong> — accrued interest and yields are
          for settlement on {settlement.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })},
          the next business day after the price date (DMO reference prices are for T+1 settlement).
          <br /><br />
          <strong style={{ color: "#1a1916" }}>Accrued interest</strong> — Actual/Actual day count
          (days elapsed ÷ actual days in coupon period), per UK gilt convention. Within 7 business
          days of a coupon the gilt trades ex-dividend and accrued interest is negative.
          <br /><br />
          <strong style={{ color: "#1a1916" }}>Deposit Equiv.</strong> — the gross yield a fully-taxable
          deposit or bond would need to match this gilt's after-tax return.
          Formula: <code>after-tax YTM + (coupon / clean price) × tax rate</code>.
          This correctly grosses up only the taxable coupon component; the
          tax-free capital gain needs no gross-up.
        </div>
      )}
    </div>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function GiltTerminal() {
  const [taxRate, setTaxRate] = useState(0.45);
  const [matFilter, setMatFilter] = useState("all");
  const [couponFilter, setCouponFilter] = useState("all");
  const [sortBy, setSortBy] = useState("atYTM");
  const [liveOverrides, setLiveOverrides] = useState({});
  const [isLive, setIsLive] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [updateStamp, setUpdateStamp] = useState("Prices: snapshot 31 Mar 2026");
  const [asOf, setAsOf] = useState(null);
  const [liveDirty, setLiveDirty] = useState({});
  const [dirtySettlement, setDirtySettlement] = useState(null);
  const [view, setView] = useState(() =>
    typeof window !== "undefined" && window.location.hash.startsWith("#ladder") ? "ladder" : "analyser");

  const settlement = useMemo(() => priceSettlement(isLive ? asOf : null), [isLive, asOf]);
  const dirtyHere = isLive && dirtySettlement === settlement.toISOString().slice(0, 10) ? liveDirty : {};
  const data = processGilts(liveOverrides, isLive, taxRate, settlement, dirtyHere);
  const filtered = applyFilters(data, { matFilter, couponFilter, sortBy });

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const url = (typeof window !== "undefined" && window.__GILT_PRICES_URL__) || PRICES_URL_DEFAULT;
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      if (!j || typeof j !== "object" || !j.prices || typeof j.prices !== "object") {
        throw new Error("Malformed price file");
      }

      const overrides = {};
      let n = 0;
      for (const [sym, val] of Object.entries(j.prices)) {
        const px = typeof val === "number" ? val
          : (val && typeof val === "object" && typeof val.px === "number") ? val.px
          : null;
        if (typeof px === "number" && Number.isFinite(px) && px > 0) {
          overrides[sym] = px;
          n++;
        }
      }

      if (n === 0) throw new Error("No usable prices in file");

      const dirty = {};
      if (j.dirty && typeof j.dirty === "object") {
        for (const [sym, v] of Object.entries(j.dirty)) {
          if (typeof v === "number" && Number.isFinite(v) && v > 0) dirty[sym] = v;
        }
      }

      setLiveOverrides(overrides);
      setLiveDirty(dirty);
      setDirtySettlement(typeof j.settlement === "string" ? j.settlement : null);
      setIsLive(true);
      setAsOf(j.asOf || null);
      setUpdateStamp(j.asOf ? `Prices · ${j.asOf}` : `Prices · ${n} loaded`);

      const ageDays = j.asOf
        ? Math.floor((Date.now() - new Date(j.asOf + "T00:00:00Z").getTime()) / 86400000)
        : null;
      if (ageDays !== null && ageDays > STALE_DAYS_WARN) {
        setNotice({
          type: "warn",
          msg: `Prices are ${ageDays} days old (last refresh: ${j.asOf}). The daily refresh job may have stopped — check GitHub Actions.`,
        });
      } else {
        setNotice({
          type: "ok",
          msg: `${n} prices loaded${j.asOf ? ` (as of ${j.asOf})` : ""}${j.source ? ` · ${j.source}` : ""}.`,
        });
        setTimeout(() => setNotice(null), 5000);
      }
    } catch (err) {
      setLiveOverrides({});
      setLiveDirty({});
      setDirtySettlement(null);
      setIsLive(false);
      setAsOf(null);
      setUpdateStamp("Snapshot 31 Mar 2026");
      setNotice({
        type: "warn",
        msg: `Couldn't load the daily price file (${err.message || err}). Showing 31 Mar 2026 snapshot.`,
      });
    }
    setRefreshing(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const TENOR_PILLS = [
    { val: "all", label: "All" }, { val: "short", label: "0–5y" },
    { val: "medium", label: "5–15y" }, { val: "long", label: "15y+" },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500&family=DM+Mono:wght@300;400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes spin { to { transform: rotate(360deg); } }
        body { margin: 0; }
        select { appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%239a978f'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; padding-right: 28px !important; }
        tr:last-child td { border-bottom: none !important; }
        tr:hover td { background: #f2f1ee !important; }
        th[title] { cursor: help; border-bottom: 1px dashed #c0bdb7 !important; }
      `}</style>

      <div style={s.wrap}>
        {/* Header */}
        <header style={s.header}>
          <div style={s.logoWrap}>
            <div style={s.logoMark}>GT</div>
            <span style={s.logoText}>Gilt Terminal</span>
            <span style={s.logoSub}>after-tax yield analyser</span>
          </div>
          <div style={s.pills}>
            {[["analyser", "Analyser"], ["ladder", "Ladder"]].map(([v, label]) => (
              <button key={v} style={view === v ? s.pillOn : s.pill}
                onClick={() => {
                  setView(v);
                  if (v === "analyser") window.history.replaceState(null, "", window.location.pathname);
                }}>{label}</button>
            ))}
          </div>
          <div style={s.hdrRight}>
            <span style={s.stamp}>{updateStamp}</span>
            {isLive && <div style={s.livePill}><LiveDot />&nbsp;Live</div>}
            <button style={s.btnRefresh} onClick={refresh} disabled={refreshing}>
              {refreshing
                ? <span style={{ width: 12, height: 12, border: "2px solid #cbc9c3", borderTopColor: "#5a5750", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                : "↻"
              }&nbsp;Refresh
            </button>
          </div>
        </header>

        {/* Body */}
        {view === "ladder" ? (
          <LadderView taxRate={taxRate} setTaxRate={setTaxRate}
            liveOverrides={liveOverrides} isLive={isLive} asOf={asOf}
            liveDirty={liveDirty} dirtySettlement={dirtySettlement} />
        ) : (
        <div style={s.layout}>
          {/* Sidebar */}
          <aside style={s.sidebar}>
            <div>
              <div style={s.secLbl}>Tax parameters</div>
              <div style={{ marginBottom: "0.7rem" }}>
                <div style={s.fieldRow}>
                  <span>Income tax rate</span>
                  <span style={s.fieldVal}>{Math.round(taxRate * 100)}%</span>
                </div>
                <input type="range" min={0} max={60} step={5} value={Math.round(taxRate * 100)}
                  onChange={e => setTaxRate(parseInt(e.target.value) / 100)}
                  style={{ width: "100%", height: 3, accentColor: "#1a6b4a", cursor: "pointer" }}
                />
              </div>
              <div style={{ fontSize: 12, color: "#5a5750", marginBottom: 4 }}>CGT on gilt gains</div>
              <div style={{ fontFamily: "DM Mono, monospace", fontSize: 12, fontWeight: 500, color: "#1a6b4a" }}>0% — fully exempt</div>
            </div>

            <hr style={s.hr} />

            <div>
              <div style={s.secLbl}>Filters</div>
              {[
                { label: "Maturity range", val: matFilter, set: setMatFilter, opts: [["all","All maturities"],["short","0 – 5 years"],["medium","5 – 15 years"],["long","15+ years"]] },
                { label: "Coupon type", val: couponFilter, set: setCouponFilter, opts: [["all","All coupons"],["low","Low coupon (≤ 2%)"],["high","High coupon (> 2%)"]] },
                { label: "Sort by", val: sortBy, set: setSortBy, opts: [["atYTM","After-tax YTM ↓"],["grossYTM","Gross YTM ↓"],["taxDrag","Tax drag ↑"],["maturity","Maturity date ↑"],["cleanPx","Clean price ↑"]] },
              ].map(({ label, val, set, opts }) => (
                <div key={label} style={{ marginBottom: "0.7rem" }}>
                  <div style={{ ...s.fieldRow, marginBottom: 3 }}><span>{label}</span></div>
                  <select style={s.selectEl} value={val} onChange={e => set(e.target.value)}>
                    {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
              ))}
            </div>

            <hr style={s.hr} />

            <div style={{ fontSize: 12, color: "#5a5750", lineHeight: 1.75 }}>
              <div style={s.secLbl}>Data source</div>
              <strong style={{ color: "#1a1916" }}>Live:</strong> UK DMO daily reference prices<br />
              <strong style={{ color: "#1a1916" }}>Fallback:</strong> snapshot 31 Mar 2026<br />
              <span style={{ color: "#9a978f", fontSize: 11 }}>
                Refreshed each weekday after LSE close by GitHub Action.
                AI uses Actual/Actual day count. YTM uses exact coupon schedule.
                {asOf && <> Last refresh: <strong style={{ color: "#1a1916" }}>{asOf}</strong>.</>}
              </span>
            </div>

            <div style={s.sbFoot}>
              Not financial advice. Verify prices before dealing.<br />
              <a href="https://giltsyield.com" target="_blank" rel="noreferrer" style={{ color: "#2563a8" }}>giltsyield.com</a>
              {" · "}
              <a href="https://www.dmo.gov.uk" target="_blank" rel="noreferrer" style={{ color: "#2563a8" }}>dmo.gov.uk</a>
            </div>
          </aside>

          {/* Main */}
          <main style={s.main}>
            {notice && (
              <Notice type={notice.type} onDismiss={() => setNotice(null)}>{notice.msg}</Notice>
            )}

            <SummaryCards data={filtered} taxRate={taxRate} />

            <div style={s.panel}>
              <div style={s.panelHdr}>
                <span style={s.panelTtl}>Ranked by after-tax yield to maturity</span>
                <div style={s.pills}>
                  {TENOR_PILLS.map(({ val, label }) => (
                    <button key={val} style={matFilter === val ? s.pillOn : s.pill}
                      onClick={() => setMatFilter(val)}>{label}</button>
                  ))}
                </div>
              </div>
              {filtered.length > 0
                ? <GiltTable data={filtered} isLive={isLive} />
                : <div style={{ padding: "3rem 2rem", textAlign: "center", color: "#9a978f" }}>No gilts match the current filters.</div>
              }
            </div>

            <MethodologyNote taxRate={taxRate} settlement={settlement} />
          </main>
        </div>
        )}
      </div>
    </>
  );
}
