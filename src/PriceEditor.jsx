import { useState, useMemo, useEffect, useRef } from "react";
import { makeManualPrice } from "./manualPrices.js";
import { solveYTM } from "./giltMath.js";
import BrokerLinks from "./BrokerLinks.jsx";
import { s } from "./styles.js";

const mono = s.mono;
const btn = { ...s.btn, minHeight: "1.9rem" };
const btnPrimary = { ...btn, background: "var(--accent)", borderColor: "var(--accent)", color: "var(--on-accent)", fontWeight: 600 };
const fmtDate = iso => new Date(iso + "T00:00:00Z")
  .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * Inline editor for a one-off live price, rendered as a full-width table row
 * under the gilt it edits. Shows a live preview of what the price means
 * (settlement, accrued, clean/dirty, gross and after-tax yield) before it is
 * applied. Used by the analyser table and the ladder table.
 *
 * props: gilt, referenceClean, current (manual price or null), taxRate,
 *        colSpan, note (optional extra line), onApply(m), onClear(), onClose()
 */
export default function PriceEditor({ gilt, referenceClean, current, taxRate, colSpan, note, onApply, onClear, onClose }) {
  const [kind, setKind] = useState(current?.kind ?? "clean");
  const [text, setText] = useState(current ? String(current.input) : "");
  const inputRef = useRef(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const m = useMemo(
    () => (text.trim() ? makeManualPrice(gilt, text, kind, { referenceClean }) : null),
    [gilt, text, kind, referenceClean]
  );
  const preview = useMemo(() => {
    if (!m?.ok) return null;
    const s = new Date(m.settlement + "T00:00:00Z");
    return {
      gross: solveYTM(gilt.c, gilt.mat, m.clean, m.ai, 0, s),
      net: solveYTM(gilt.c, gilt.mat, m.clean, m.ai, taxRate, s),
    };
  }, [m, gilt, taxRate]);

  const apply = () => { if (m?.ok) { onApply(m); onClose(); } };
  const pct = v => (v == null ? "—" : v.toFixed(3) + "%");

  return (
    <tr>
      <td colSpan={colSpan} style={{ background: "var(--bg)", borderBottom: "1px solid var(--separator)", padding: "10px 14px" }}>
        <div className="gt-reveal" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", fontSize: "0.75rem", color: "var(--text-2)" }}>
          <strong style={{ color: "var(--text)", fontWeight: 500 }}>Live price — {gilt.name}</strong>
          <select value={kind} onChange={e => setKind(e.target.value)}
            style={{ ...s.selectEl, width: "auto", padding: "5px 8px" }}
            aria-label="Price type">
            <option value="clean">Clean price</option>
            <option value="dirty">Dirty price (incl. accrued)</option>
          </select>
          <span>£</span>
          <input ref={inputRef} inputMode="decimal" value={text} placeholder={referenceClean?.toFixed(2)}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") apply(); if (e.key === "Escape") onClose(); }}
            aria-label="Price per £100 nominal"
            style={{ ...s.inputEl, width: 96, padding: "5px 8px" }} />
          <span style={{ color: "var(--text-3)" }}>per £100 nominal</span>
          <button style={btnPrimary} disabled={!m?.ok} onClick={apply}>Apply</button>
          {current && <button style={btn} onClick={() => { onClear(); onClose(); }}>Back to {referenceClean != null ? "file" : "snapshot"} price</button>}
          <button style={btn} onClick={onClose}>Cancel</button>
          <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-3)" }}>
            Check the price at <BrokerLinks gilt={gilt} />
          </span>
        </div>

        <div style={{ marginTop: 7, fontSize: "0.7188rem", lineHeight: 1.7, color: "var(--text-2)" }}>
          {m && !m.ok && <span style={{ color: "var(--neg)" }}>{m.error}</span>}
          {m?.ok && (
            <>
              Settles <strong>{fmtDate(m.settlement)}</strong> (T+1) · accrued{" "}
              <span style={mono}>{m.ai.toFixed(4)}</span>{m.exDiv && " (ex-dividend: next coupon goes to the seller)"} ·{" "}
              clean <span style={mono}>{m.clean.toFixed(4)}</span> · dirty <span style={mono}>{m.dirty.toFixed(4)}</span>
              {" "}→ gross YTM <strong style={mono}>{pct(preview?.gross)}</strong>
              {taxRate > 0 && <> · after {Math.round(taxRate * 100)}% tax <strong style={{ ...mono, color: "var(--accent)" }}>{pct(preview?.net)}</strong></>}
              {m.warning && <div style={{ color: "var(--warn)" }}>⚠ {m.warning}</div>}
            </>
          )}
          <div style={{ color: "var(--text-3)" }}>
            One-off: used in the analyser and the ladder for this visit only — not saved, not in share links, cleared on reload.
            {note && <> {note}</>}
          </div>
        </div>
      </td>
    </tr>
  );
}
