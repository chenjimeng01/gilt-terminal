// Shared inline-style tokens for the analyser and the ladder. Colours come
// from the custom properties in theme.css, so they follow light and dark.
// Type sizes are in rem so the layout scales with the reader's text size.

export const mono = { fontFamily: "var(--font-num)", fontVariantNumeric: "tabular-nums" };

const field = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, color: "var(--text)", fontSize: "0.8125rem", padding: "7px 10px", width: "100%" };
const btn = { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, padding: "6px 13px", borderRadius: 8, fontSize: "0.78rem", fontWeight: 500, cursor: "pointer", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", whiteSpace: "nowrap" };
const th = { padding: "9px 8px", fontSize: "0.6875rem", fontWeight: 600, letterSpacing: "0.03em", color: "var(--text-3)", textAlign: "left", borderBottom: "1px solid var(--separator)", whiteSpace: "nowrap" };
const td = { padding: "9px 8px", whiteSpace: "nowrap", verticalAlign: "middle", fontSize: "0.8125rem", borderBottom: "1px solid var(--separator)" };
const notice = { display: "flex", alignItems: "flex-start", gap: 9, padding: "11px 14px", borderRadius: 12, fontSize: "0.8125rem", lineHeight: 1.55 };

export const s = {
  mono,
  editBtn: { border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text-3)", borderRadius: 6, fontSize: "0.6875rem", lineHeight: 1, padding: "4px 6px", cursor: "pointer" },
  manualBadge: { fontSize: "0.6875rem", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", padding: "1px 6px", borderRadius: 10, background: "var(--warn-soft)", color: "var(--warn)", cursor: "help" },
  badge: { display: "inline-block", fontSize: "0.6875rem", fontWeight: 600, padding: "2px 7px", borderRadius: 12, letterSpacing: "0.02em", marginLeft: 6 },
  secLbl: { fontSize: "0.6875rem", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 8 },
  fieldRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: "0.75rem", color: "var(--text-2)", marginBottom: 4 },
  fieldVal: { ...mono, fontSize: "0.75rem", fontWeight: 600, color: "var(--accent)" },
  selectEl: field,
  inputEl: { ...field, ...mono },
  hr: { border: "none", borderTop: "1px solid var(--separator)", margin: "0.1rem 0" },
  sbFoot: { marginTop: "auto", paddingTop: "0.9rem", borderTop: "1px solid var(--separator)", fontSize: "0.6875rem", color: "var(--text-3)", lineHeight: 1.7 },
  btn,
  btnRefresh: btn,
  cards: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.75rem" },
  card: { background: "var(--surface)", border: "1px solid var(--separator)", borderRadius: 14, padding: "0.95rem 1.1rem", boxShadow: "var(--shadow-1)", minWidth: 0 },
  cardLbl: { fontSize: "0.75rem", fontWeight: 500, color: "var(--text-3)", marginBottom: 6 },
  // Display figures: heavier, tight leading, negative tracking as they grow
  cardVal: { fontSize: "1.625rem", fontWeight: 600, letterSpacing: "-0.022em", lineHeight: 1.1 },
  cardSub: { fontSize: "0.72rem", color: "var(--text-3)", marginTop: 4 },
  panel: { background: "var(--surface)", border: "1px solid var(--separator)", borderRadius: 14, boxShadow: "var(--shadow-1)", overflow: "hidden" },
  panelHdr: { padding: "0.7rem 1rem", borderBottom: "1px solid var(--separator)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 },
  panelTtl: { fontSize: "0.8125rem", fontWeight: 600, color: "var(--text)", letterSpacing: "-0.005em" },
  tblWrap: { overflowX: "auto" },
  th,
  thR: { ...th, textAlign: "right" },
  td,
  tdBase: td,
  tdR: { ...td, textAlign: "right" },
  ts: { display: "flex", justifyContent: "space-between", padding: "7px 12px", borderTop: "1px solid var(--separator)", fontSize: "0.6875rem", color: "var(--text-3)" },
  noticeInfo: { ...notice, background: "var(--info-soft)", color: "var(--info)", border: "1px solid var(--info-border)" },
  noticeWarn: { ...notice, background: "var(--warn-soft)", color: "var(--warn)", border: "1px solid var(--warn-border)" },
  methodBox: { background: "var(--surface)", border: "1px solid var(--separator)", borderRadius: 14, padding: "1rem 1.1rem", fontSize: "0.78rem", color: "var(--text-2)", lineHeight: 1.7, maxWidth: "62rem" },
};
