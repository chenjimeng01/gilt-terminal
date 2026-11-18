import { useState } from "react";
import { STATUSES, mayEnter, readCertified, writeCertified } from "./accessGate.js";

const session = () => { try { return window.sessionStorage; } catch { return null; } };

const c = {
  wrap: { minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem", color: "var(--text)" },
  card: { background: "var(--surface)", border: "1px solid var(--separator)", borderRadius: 20, boxShadow: "var(--shadow-2)", maxWidth: 560, width: "100%", padding: "1.8rem 1.9rem", animation: "materialise 420ms cubic-bezier(.2,.8,.2,1)" },
  logo: { display: "flex", alignItems: "center", gap: 10, marginBottom: "1.1rem" },
  mark: { width: 30, height: 30, borderRadius: 8, background: "var(--accent)", color: "var(--on-accent)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-num)", fontSize: "0.6875rem", fontWeight: 700 },
  h1: { fontSize: "1.375rem", fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.15, margin: "0 0 .6rem" },
  p: { fontSize: "0.8125rem", lineHeight: 1.6, color: "var(--text-2)", margin: "0 0 .8rem" },
  opt: on => ({ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", border: `1px solid ${on ? "var(--accent)" : "var(--separator)"}`, background: on ? "var(--accent-soft)" : "var(--surface)", borderRadius: 12, marginBottom: 8, cursor: "pointer" }),
  optLbl: { fontSize: "0.8438rem", fontWeight: 500 },
  optSub: { fontSize: "0.75rem", color: "var(--text-3)", marginTop: 1 },
  confirm: { display: "flex", gap: 9, alignItems: "flex-start", fontSize: "0.7812rem", lineHeight: 1.55, color: "var(--text-2)", margin: "1rem 0" },
  btn: on => ({ width: "100%", minHeight: "2.75rem", padding: "10px 14px", borderRadius: 12, border: "none", background: "var(--accent)", color: "var(--on-accent)", fontSize: "0.9375rem", fontWeight: 600, cursor: on ? "pointer" : "default" }),
  refused: { background: "var(--warn-soft)", border: "1px solid var(--warn-border)", color: "var(--warn)", borderRadius: 8, padding: "11px 13px", fontSize: "0.8125rem", lineHeight: 1.6, marginTop: ".9rem" },
  foot: { fontSize: "0.7188rem", lineHeight: 1.6, color: "var(--text-3)", marginTop: "1rem" },
};

/**
 * Renders `children` only after the visitor self-certifies a permitted status
 * (see accessGate.js). Nothing behind the gate is mounted — and so no prices
 * are fetched — until then.
 */
export default function AccessGate({ children }) {
  const [entered, setEntered] = useState(() => readCertified(session()) != null);
  const [status, setStatus] = useState(null);
  const [confirmed, setConfirmed] = useState(false);

  if (entered) return children;

  const refused = status === "other";
  const ok = mayEnter(status, confirmed);
  const enter = () => { if (ok) { writeCertified(session(), status); setEntered(true); } };

  return (
    <div style={c.wrap}>
      <div style={c.card} role="dialog" aria-labelledby="gate-title">
        <div style={c.logo}><div style={c.mark}>GT</div><span style={{ fontSize: "0.9375rem", fontWeight: 600, letterSpacing: "-0.012em" }}>Gilt Terminal</span></div>
        <h1 id="gate-title" style={c.h1}>For investment professionals only</h1>
        <p style={c.p}>
          Gilt Terminal is a calculator for UK gilt prices and yields. It provides information only. It does not give
          investment, tax or financial advice or personal recommendations, and it is not intended for private (retail) investors.
        </p>
        <p style={{ ...c.p, color: "var(--text)", fontWeight: 500 }}>Please confirm which describes you:</p>

        <div role="radiogroup" aria-label="Your status">
          {STATUSES.map(s => (
            <label key={s.id} className="gt-pressable" style={c.opt(status === s.id)}>
              <input type="radio" name="status" value={s.id} checked={status === s.id}
                onChange={() => { setStatus(s.id); setConfirmed(false); }} style={{ marginTop: 3 }} />
              <span><div style={c.optLbl}>{s.label}</div><div style={c.optSub}>{s.detail}</div></span>
            </label>
          ))}
        </div>

        {refused ? (
          <div style={c.refused} role="alert">
            Sorry — Gilt Terminal isn't available to you. It is directed only at financial advisers and professional
            and institutional investors. If you are a private investor, consider speaking to an authorised financial
            adviser; the UK Debt Management Office (dmo.gov.uk) publishes gilt prices and information for everyone.
          </div>
        ) : (
          <>
            <label style={c.confirm}>
              <input type="checkbox" checked={confirmed} disabled={!status} onChange={e => setConfirmed(e.target.checked)}
                style={{ marginTop: 3 }} />
              <span>
                I confirm that the status I have selected is accurate, and I understand that Gilt Terminal provides
                information only — not advice or a recommendation — and that I am responsible for my own decisions
                and for checking prices and figures before relying on them.
              </span>
            </label>
            <button style={c.btn(ok)} disabled={!ok} onClick={enter}>Enter Gilt Terminal</button>
          </>
        )}

        <div style={c.foot}>
          A personal, non-commercial project. Not operated by or on behalf of any FCA-authorised firm, and not a
          regulated service. You will be asked to confirm again on each visit.
        </div>
      </div>
    </div>
  );
}
