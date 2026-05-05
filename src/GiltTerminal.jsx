import { useState, useEffect, useCallback } from "react";

// ── Constants ────────────────────────────────────────────────────────────────
const NOW = new Date();

// Path to the daily-refreshed price file. The file is rebuilt by
// .github/workflows/refresh-gilt-prices.yml from the UK DMO CSV and
// committed to the repo. The site fetches it from the same origin.
//
// To override (e.g. fetch from the raw GitHub URL of a different repo)
// set window.__GILT_PRICES_URL__ before this component mounts.
const PRICES_URL_DEFAULT = "/gilt-prices.json";

// Days of staleness before the UI shows a warning. Weekend + 1 day grace
// period covers a typical Monday-morning load against Friday's data.
const STALE_DAYS_WARN = 4;

const MASTER = [
  {name:"4¼% Treasury Gilt 2034",   c:4.25,  mat:"2034-07-31",px:96.53, ai:0.704,gy:4.816,sym:"TN34"},
  {name:"4 3/8% Treasury Gilt 2040",c:4.375, mat:"2040-01-31",px:91.97, ai:0.725,gy:5.263,sym:"TG40"},
  {name:"1½% Treasury Gilt 2047",   c:1.5,   mat:"2047-07-22",px:50.49, ai:0.286,gy:5.534,sym:"TG47"},
  {name:"0 7/8% Treasury Gilt 2046",c:0.875, mat:"2046-01-31",px:45.04, ai:0.145,gy:5.511,sym:"TG46"},
  {name:"3¼% Treasury Gilt 2044",   c:3.25,  mat:"2044-01-22",px:75.57, ai:0.619,gy:5.475,sym:"TG44"},
  {name:"1¼% Treasury Gilt 2041",   c:1.25,  mat:"2041-10-22",px:57.88, ai:0.553,gy:5.312,sym:"TG41"},
  {name:"1¾% Treasury Gilt 2049",   c:1.75,  mat:"2049-01-22",px:51.92, ai:0.334,gy:5.536,sym:"TG49"},
  {name:"4 1/8% Treasury Gilt 2029",c:4.125, mat:"2029-07-22",px:99.24, ai:0.786,gy:4.419,sym:"TS29"},
  {name:"4½% Treasury Gilt 2028",   c:4.5,   mat:"2028-06-07",px:100.28,ai:1.422,gy:4.408,sym:"TS28"},
  {name:"3¾% Treasury Gilt 2027",   c:3.75,  mat:"2027-03-07",px:99.47, ai:0.255,gy:4.373,sym:"TS27"},
  {name:"1¾% Treasury Gilt 2037",   c:1.75,  mat:"2037-09-07",px:72.01, ai:0.119,gy:5.053,sym:"TG37"},
  {name:"0 5/8% Treasury Gilt 2035",c:0.625, mat:"2035-07-31",px:68.83, ai:0.104,gy:4.869,sym:"TG35"},
  {name:"4 1/8% Treasury Gilt 2033",c:4.125, mat:"2033-03-07",px:97.10, ai:0.280,gy:4.671,sym:"T33H"},
  {name:"0 7/8% Green Gilt 2033",   c:0.875, mat:"2033-07-31",px:76.82, ai:0.145,gy:4.693,sym:"TG33"},
  {name:"1% Treasury Gilt 2032",    c:1.0,   mat:"2032-01-31",px:82.20, ai:0.166,gy:4.549,sym:"TG32"},
  {name:"0¼% Treasury Gilt 2031",   c:0.25,  mat:"2031-07-31",px:80.62, ai:0.041,gy:4.412,sym:"TG31"},
  {name:"4% Treasury Gilt 2029",    c:4.0,   mat:"2029-05-22",px:98.85, ai:1.915,gy:4.442,sym:"T29K"},
  {name:"0 3/8% Treasury Gilt 2030",c:0.375, mat:"2030-10-22",px:83.90, ai:0.166,gy:4.348,sym:"TG30"},
  {name:"3¾% Treasury Gilt 2038",   c:3.75,  mat:"2038-01-29",px:88.35, ai:0.642,gy:5.135,sym:"TG38"},
  {name:"1 1/8% Treasury Gilt 2039",c:1.125, mat:"2039-01-31",px:62.98, ai:0.186,gy:5.153,sym:"TR39"},
  {name:"4¾% Treasury Stock 2038",  c:4.75,  mat:"2038-12-07",px:96.79, ai:1.501,gy:5.160,sym:"TR38"},
  {name:"4¾% Treasury Gilt 2035",   c:4.75,  mat:"2035-10-22",px:99.01, ai:2.737,gy:4.939,sym:"T35V"},
  {name:"0½% Treasury Gilt 2061",   c:0.5,   mat:"2061-10-22",px:24.03, ai:0.221,gy:5.290,sym:"TG61"},
  {name:"4 3/8% Treasury Gilt 2028",c:4.375, mat:"2028-03-07",px:99.96, ai:0.297,gy:4.441,sym:"TE28"},
  {name:"2½% Treasury Gilt 2065",   c:2.5,   mat:"2065-07-22",px:52.91, ai:0.477,gy:5.472,sym:"TG65"},
  {name:"4¾% Treasury Gilt 2043",   c:4.75,  mat:"2043-10-22",px:92.79, ai:2.101,gy:5.462,sym:"TR43"},
  {name:"0 7/8% Treasury Gilt 2029",c:0.875, mat:"2029-10-22",px:88.92, ai:0.387,gy:4.308,sym:"TR29"},
  {name:"6% Treasury Stock 2028",   c:6.0,   mat:"2028-12-07",px:104.29,ai:1.896,gy:4.331,sym:"TR28"},
  {name:"4¼% Treasury Gilt 2027",   c:4.25,  mat:"2027-12-07",px:99.89, ai:1.343,gy:4.362,sym:"TR27"},
  {name:"0 1/8% Treasury Gilt 2028",c:0.125, mat:"2028-01-31",px:92.91, ai:0.021,gy:4.224,sym:"TN28"},
  {name:"0 5/8% Treasury Gilt 2050",c:0.625, mat:"2050-10-22",px:35.14, ai:0.276,gy:5.518,sym:"TG50"},
  {name:"1¾% Treasury Gilt 2057",   c:1.75,  mat:"2057-07-22",px:44.60, ai:0.334,gy:5.538,sym:"TG57"},
  {name:"1½% Green Gilt 2053",      c:1.5,   mat:"2053-07-31",px:43.73, ai:0.249,gy:5.582,sym:"TG53"},
  {name:"1¼% Treasury Gilt 2051",   c:1.25,  mat:"2051-07-31",px:42.25, ai:0.207,gy:5.579,sym:"T51A"},
  {name:"4½% Treasury Gilt 2034",   c:4.5,   mat:"2034-09-07",px:98.31, ai:0.306,gy:4.799,sym:"TR34"},
  {name:"3¼% Treasury Gilt 2033",   c:3.25,  mat:"2033-01-31",px:92.11, ai:0.539,gy:4.660,sym:"TR33"},
  {name:"4¼% Treasury Stock 2032",  c:4.25,  mat:"2032-06-07",px:98.79, ai:1.343,gy:4.524,sym:"TR32"},
  {name:"4¾% Treasury Gilt 2030",   c:4.75,  mat:"2030-12-07",px:101.78,ai:1.501,gy:4.366,sym:"TR30"},
  {name:"0 3/8% Treasury Gilt 2026",c:0.375, mat:"2026-10-22",px:98.07, ai:0.166,gy:3.939,sym:"T26A"},
  {name:"4% Treasury Gilt 2063",    c:4.0,   mat:"2063-10-22",px:76.79, ai:1.769,gy:5.534,sym:"TR63"},
  {name:"4% Treasury Gilt 2060",    c:4.0,   mat:"2060-01-22",px:77.74, ai:0.762,gy:5.521,sym:"TR60"},
  {name:"1 5/8% Treasury Gilt 2071",c:1.625, mat:"2071-10-22",px:38.04, ai:0.719,gy:5.248,sym:"TG71"},
  {name:"4 3/8% Treasury Gilt 2030",c:4.375, mat:"2030-03-07",px:99.94, ai:0.297,gy:4.439,sym:"T30"},
  {name:"4% Treasury Gilt 2031",    c:4.0,   mat:"2031-10-22",px:97.63, ai:1.769,gy:4.536,sym:"T31"},
  {name:"5¼% Treasury Gilt 2041",   c:5.25,  mat:"2041-01-31",px:100.01,ai:0.870,gy:5.316,sym:"T41F"},
  {name:"4 5/8% Treasury Gilt 2034",c:4.625, mat:"2034-01-31",px:99.43, ai:0.767,gy:4.767,sym:"T34"},
  {name:"4 5/8% Green Gilt 2037",   c:4.625, mat:"2037-03-07",px:96.82, ai:0.264,gy:5.066,sym:"T37H"},
  {name:"4½% Treasury Gilt 2035",   c:4.5,   mat:"2035-03-07",px:97.71, ai:0.306,gy:4.876,sym:"T35"},
  {name:"1 5/8% Treasury Gilt 2054",c:1.625, mat:"2054-10-22",px:44.70, ai:0.719,gy:5.552,sym:"TR54"},
  {name:"4¼% Treasury Gilt 2039",   c:4.25,  mat:"2039-09-07",px:91.36, ai:0.289,gy:5.214,sym:"T39"},
  {name:"4¼% Treasury Gilt 2055",   c:4.25,  mat:"2055-12-07",px:82.05, ai:1.343,gy:5.555,sym:"TR4Q"},
  {name:"1½% Treasury Gilt 2026",   c:1.5,   mat:"2026-07-22",px:99.29, ai:0.286,gy:3.897,sym:"TG26"},
  {name:"4¼% Treasury Gilt 2040",   c:4.25,  mat:"2040-12-07",px:90.12, ai:1.343,gy:5.289,sym:"T40"},
  {name:"4½% Treasury Gilt 2042",   c:4.5,   mat:"2042-12-07",px:90.93, ai:1.422,gy:5.397,sym:"T42"},
  {name:"3½% Treasury Gilt 2045",   c:3.5,   mat:"2045-01-22",px:77.56, ai:0.667,gy:5.489,sym:"T45"},
  {name:"4¼% Treasury Gilt 2046",   c:4.25,  mat:"2046-12-07",px:85.29, ai:1.343,gy:5.517,sym:"T46"},
  {name:"4¼% Treasury Gilt 2049",   c:4.25,  mat:"2049-12-07",px:84.08, ai:1.343,gy:5.529,sym:"T49"},
  {name:"0½% Treasury Gilt 2029",   c:0.5,   mat:"2029-01-31",px:90.07, ai:0.083,gy:4.298,sym:"TG29"},
  {name:"1 5/8% Treasury Gilt 2028",c:1.625, mat:"2028-10-22",px:93.74, ai:0.719,gy:4.269,sym:"TG28"},
  {name:"1¼% Treasury Gilt 2027",   c:1.25,  mat:"2027-07-22",px:96.12, ai:0.238,gy:4.387,sym:"TG27"},
  {name:"3½% Treasury Gilt 2068",   c:3.5,   mat:"2068-07-22",px:68.64, ai:0.667,gy:5.461,sym:"TR68"},
  {name:"4 1/8% Treasury Gilt 2027",c:4.125, mat:"2027-01-29",px:99.86, ai:0.706,gy:4.341,sym:"T27A"},
  {name:"4¼% Treasury Stock 2036",  c:4.25,  mat:"2036-03-07",px:94.92, ai:0.289,gy:4.961,sym:"T4Q"},
  {name:"3¾% Treasury Gilt 2052",   c:3.75,  mat:"2052-07-22",px:76.05, ai:0.715,gy:5.554,sym:"T52"},
  {name:"4 1/8% Treasury Gilt 2031",c:4.125, mat:"2031-03-07",px:98.59, ai:0.280,gy:4.496,sym:"T31H"},
  {name:"4 3/8% Treasury Gilt 2054",c:4.375, mat:"2054-07-31",px:83.86, ai:0.725,gy:5.582,sym:"T54"},
  {name:"3¾% Treasury Gilt 2053",   c:3.75,  mat:"2053-10-22",px:75.19, ai:1.659,gy:5.586,sym:"T53"},
  {name:"5 3/8% Treasury Gilt 2056",c:5.375, mat:"2056-01-31",px:98.44, ai:0.891,gy:5.556,sym:"T56"},
  {name:"1 1/8% Treasury Gilt 2073",c:1.125, mat:"2073-10-22",px:29.78, ai:0.498,gy:5.078,sym:"TR73"},
];

// ── Maths ─────────────────────────────────────────────────────────────────────
function calcAI(coupon, matStr) {
  const mat = new Date(matStr);
  const mo = mat.getMonth(), dy = mat.getDate(), yr = NOW.getFullYear();
  const cands = [
    new Date(yr, mo, dy), new Date(yr, mo - 6, dy),
    new Date(yr - 1, mo, dy), new Date(yr - 1, mo - 6, dy),
  ].filter(d => d <= NOW);
  const last = cands.reduce((a, b) => (b > a ? b : a));
  const days = (NOW - last) / 86400000;
  return (coupon / 2) * (days / 182.5);
}

function solveYTM(coupon, matStr, cleanPx, ai, taxRate) {
  const mat = new Date(matStr);
  const dp = cleanPx + ai;
  const yrs = (mat - NOW) / (365.25 * 86400000);
  if (yrs < 0.05) return null;
  const n = Math.max(1, Math.round(yrs * 2));
  const sc = (coupon / 2) * (1 - taxRate);
  const pv = r => { const d = r / 2; let t = 0; for (let i = 1; i <= n; i++) t += sc / (1 + d) ** i; return t + 100 / (1 + d) ** n; };
  let lo = 0.0001, hi = 0.30;
  for (let i = 0; i < 80; i++) { const m = (lo + hi) / 2; pv(m) > dp ? (lo = m) : (hi = m); }
  return ((lo + hi) / 2) * 100;
}

function getTenor(matStr) {
  const y = (new Date(matStr) - NOW) / (365.25 * 86400000);
  return y <= 5 ? "short" : y <= 15 ? "medium" : "long";
}

function processGilts(liveOverrides, isLive, taxRate) {
  return MASTER.map(g => {
    const cp = liveOverrides[g.sym] ?? g.px;
    const ai = isLive ? calcAI(g.c, g.mat) : g.ai;
    const grossYTM = isLive ? (solveYTM(g.c, g.mat, cp, ai, 0) ?? g.gy) : g.gy;
    const at = taxRate === 0 ? grossYTM : solveYTM(g.c, g.mat, cp, ai, taxRate);
    if (!at) return null;
    const gey = taxRate === 0 ? at : at / (1 - taxRate);
    const drag = taxRate === 0 ? 0 : grossYTM - at;
    const yrs = (new Date(g.mat) - NOW) / (365.25 * 86400000);
    return { ...g, cp, ai, grossYTM, at, gey, drag, yrs, tenor: getTenor(g.mat), couponType: g.c <= 2 ? "low" : "high", dPx: cp - g.px };
  }).filter(Boolean);
}

function applyFilters(data, { matFilter, couponFilter, sortBy }) {
  let d = [...data];
  if (matFilter !== "all") d = d.filter(g => g.tenor === matFilter);
  if (couponFilter !== "all") d = d.filter(g => g.couponType === couponFilter);
  const sorts = { atYTM: (a, b) => b.at - a.at, grossYTM: (a, b) => b.grossYTM - a.grossYTM, taxDrag: (a, b) => a.drag - b.drag, maturity: (a, b) => new Date(a.mat) - new Date(b.mat), cleanPx: (a, b) => a.cp - b.cp };
  return d.sort(sorts[sortBy] ?? sorts.atYTM);
}

// ── Sub-components ────────────────────────────────────────────────────────────
const s = {
  // Layout
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
  // Sidebar elements
  secLbl: { fontSize: 10, fontWeight: 500, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9a978f", marginBottom: 6 },
  fieldRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "#5a5750", marginBottom: 4 },
  fieldVal: { fontFamily: "DM Mono, monospace", fontSize: 12, fontWeight: 500, color: "#1a6b4a" },
  selectEl: { background: "#fff", border: "1px solid #e0deda", borderRadius: 6, color: "#1a1916", fontFamily: "'DM Sans', sans-serif", fontSize: 13, padding: "7px 10px", width: "100%", outline: "none" },
  hr: { border: "none", borderTop: "1px solid #e0deda", margin: "0.1rem 0" },
  sbFoot: { marginTop: "auto", paddingTop: "0.9rem", borderTop: "1px solid #e0deda", fontSize: 11, color: "#9a978f", lineHeight: 1.8 },
  // Buttons
  btnBase: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 13px", borderRadius: 6, fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500, cursor: "pointer", border: "1px solid #e0deda", background: "#fff", color: "#5a5750", transition: "all .12s", whiteSpace: "nowrap" },
  btnRefresh: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "7px 13px", borderRadius: 6, fontFamily: "'DM Sans', sans-serif", fontSize: 12, fontWeight: 500, cursor: "pointer", border: "1px solid #e0deda", background: "#fff", color: "#5a5750", whiteSpace: "nowrap" },
  // Cards
  cards: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" },
  card: { background: "#fff", border: "1px solid #e0deda", borderRadius: 6, padding: "0.9rem 1rem", boxShadow: "0 1px 3px rgba(0,0,0,.06)" },
  cardLbl: { fontSize: 11, color: "#9a978f", marginBottom: 3 },
  cardVal: { fontSize: 22, fontWeight: 300, letterSpacing: "-0.02em", lineHeight: 1 },
  cardSub: { fontSize: 11, color: "#9a978f", marginTop: 2 },
  // Panel
  panel: { background: "#fff", border: "1px solid #e0deda", borderRadius: 6, boxShadow: "0 1px 3px rgba(0,0,0,.06)", overflow: "hidden" },
  panelHdr: { padding: "0.65rem 1rem", borderBottom: "1px solid #e0deda", display: "flex", alignItems: "center", justifyContent: "space-between", background: "#f2f1ee" },
  panelTtl: { fontSize: 12, fontWeight: 500, color: "#5a5750" },
  pills: { display: "flex", gap: 4 },
  pill: { fontSize: 11, padding: "3px 9px", borderRadius: 20, border: "1px solid #e0deda", color: "#9a978f", background: "#fff", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" },
  pillOn: { fontSize: 11, padding: "3px 9px", borderRadius: 20, border: "1px solid rgba(26,107,74,.18)", color: "#1a6b4a", background: "#e8f5ef", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", fontWeight: 500 },
  // Table
  tblWrap: { overflowX: "auto" },
  th: { background: "#f2f1ee", padding: "7px 11px", fontSize: 11, fontWeight: 500, letterSpacing: "0.04em", color: "#9a978f", textAlign: "left", borderBottom: "1px solid #e0deda", whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" },
  thR: { background: "#f2f1ee", padding: "7px 11px", fontSize: 11, fontWeight: 500, letterSpacing: "0.04em", color: "#9a978f", textAlign: "right", borderBottom: "1px solid #e0deda", whiteSpace: "nowrap" },
  tdBase: { padding: "7px 11px", whiteSpace: "nowrap", verticalAlign: "middle", fontSize: 13, borderBottom: "1px solid #e0deda" },
  tdR: { padding: "7px 11px", whiteSpace: "nowrap", verticalAlign: "middle", fontSize: 13, textAlign: "right", borderBottom: "1px solid #e0deda" },
  ts: { display: "flex", justifyContent: "space-between", padding: "5px 11px", background: "#f2f1ee", borderTop: "1px solid #e0deda", fontSize: 11, color: "#9a978f" },
  // Notice
  noticeInfo: { display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", borderRadius: 6, fontSize: 13, lineHeight: 1.6, background: "#e8f0fb", color: "#2563a8", border: "1px solid rgba(37,99,168,.18)" },
  noticeWarn: { display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", borderRadius: 6, fontSize: 13, lineHeight: 1.6, background: "#fef3e2", color: "#92600a", border: "1px solid rgba(146,96,10,.2)" },
  noticeOk:   { display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 13px", borderRadius: 6, fontSize: 13, lineHeight: 1.6, background: "#e8f5ef", color: "#1a6b4a", border: "1px solid rgba(26,107,74,.18)" },
};

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
  const best = data[0];
  const avgDrag = data.length ? data.reduce((s, g) => s + g.drag, 0) / data.length : 0;
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
        <div style={{ ...s.cardVal, color: "#b91c1c" }}>{data.length ? `-${avgDrag.toFixed(2)}%` : "—"}</div>
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
  const maxAt = data.length ? Math.max(...data.map(g => g.at)) : 1;
  const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div style={s.panel}>
      <div style={s.tblWrap}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["#", "Gilt", "Coupon", "Maturity", "Tenor", "Clean £", "Δ Price", "Gross YTM", "After-Tax YTM", "Gross Equiv. Yield", "Tax Drag", "Type", "Relative"].map((h, i) => (
                <th key={h} style={i <= 1 ? s.th : s.thR}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((g, i) => {
              const isTop = i === 0;
              const rowBg = isTop ? "#e8f5ef" : i % 2 === 0 ? "#fff" : "#fafaf9";
              const matLbl = new Date(g.mat).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
              const pct = ((g.at / maxAt) * 100).toFixed(1);
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
                  {td(<span style={{ fontFamily: "DM Mono, monospace", fontSize: 12, color: "#9a978f" }}>{g.grossYTM.toFixed(3)}%</span>, true)}
                  {td(<strong style={{ fontFamily: "DM Mono, monospace", fontSize: 14, fontWeight: 500, color: "#1a6b4a" }}>{g.at.toFixed(3)}%</strong>, true)}
                  {td(<strong style={{ fontFamily: "DM Mono, monospace", fontSize: 13, fontWeight: 500, color: "#2563a8" }}>{g.gey.toFixed(3)}%</strong>, true)}
                  {td(<span style={{ fontFamily: "DM Mono, monospace", fontSize: 12, color: "#b91c1c" }}>-{g.drag.toFixed(2)}%</span>, true)}
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
        <span>{isLive ? "⬤ Live · UK DMO daily reference prices" : "◯ Cached · giltsyield.com 31 Mar 2026"}</span>
        <span>{now}</span>
      </div>
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

  const data = processGilts(liveOverrides, isLive, taxRate);
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

      // Accept either { sym: number } or { sym: { px: number } } shape.
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

      setLiveOverrides(overrides);
      setIsLive(true);
      setAsOf(j.asOf || null);
      setUpdateStamp(j.asOf ? `Prices · ${j.asOf}` : `Prices · ${n} loaded`);

      // Staleness check (calendar days; weekend tolerated by STALE_DAYS_WARN).
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
      // Fall back to the in-file snapshot.
      setLiveOverrides({});
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

  // Fetch once on mount. The price file is rebuilt server-side once per
  // weekday by the GitHub Actions workflow — no need to re-poll within a
  // session.
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
      `}</style>

      <div style={s.wrap}>
        {/* Header */}
        <header style={s.header}>
          <div style={s.logoWrap}>
            <div style={s.logoMark}>GT</div>
            <span style={s.logoText}>Gilt Terminal</span>
            <span style={s.logoSub}>after-tax yield analyser</span>
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
              <strong style={{ color: "#1a1916" }}>Fallback:</strong> giltsyield.com snapshot 31 Mar 2026<br />
              <span style={{ color: "#9a978f", fontSize: 11 }}>
                Refreshed each weekday after the LSE close by a GitHub Action. Accrued interest calculated locally. 0% CGT on redemption gain.
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
          </main>
        </div>
      </div>
    </>
  );
}
