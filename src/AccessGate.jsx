import { useState } from "react";
import { STATUSES, mayEnter, readCertified, writeCertified } from "./accessGate.js";

const session = () => { try { return window.sessionStorage; } catch { return null; } };

const c = {
  wrap: { minHeight: "100vh", background: "#f7f6f3", display: "flex", alignItems: "center", justifyContent: "center", padding: "1.5rem", fontFamily: "'DM Sans', system-ui, sans-serif", color: "#1a1916" },
  card: { background: "#fff", border: "1px solid #e0deda", borderRadius: 8, boxShadow: "0 1px 3px rgba(0,0,0,.06)", maxWidth: 560, width: "100%", padding: "1.6rem 1.7rem" },
  logo: { display: "flex", alignItems: "center", gap: 10, marginBottom: "1.1rem" },
  mark: { width: 30, height: 30, borderRadius: 6, background: "#1a6b4a", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "DM Mono, monospace", fontSize: 12, fontWeight: 500 },
  h1: { fontSize: 18, fontWeight: 500, margin: "0 0 .5rem" },
  p: { fontSize: 13, lineHeight: 1.6, color: "#5a5750", margin: "0 0 .8rem" },
  opt: on => ({ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", border: `1px solid ${on ? "#1a6b4a" : "#e0deda"}`, background: on ? "#f3faf6" : "#fff", borderRadius: 6, marginBottom: 7, cursor: "pointer" }),
  optLbl: { fontSize: 13.5, fontWeight: 500 },
  optSub: { fontSize: 12, color: "#9a978f", marginTop: 1 },
  confirm: { display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12.5, lineHeight: 1.55, color: "#5a5750", margin: "1rem 0" },
  btn: on => ({ width: "100%", padding: "10px 14px", borderRadius: 6, border: "1px solid #1a6b4a", background: "#1a6b4a", color: "#fff", fontSize: 13.5, fontWeight: 500, fontFamily: "inherit", cursor: on ? "pointer" : "default", opacity: on ? 1 : 0.4 }),
  refused: { background: "#fef3e2", border: "1px solid rgba(146,96,10,.2)", color: "#92600a", borderRadius: 6, padding: "11px 13px", fontSize: 13, lineHeight: 1.6, marginTop: ".9rem" },
  foot: { fontSize: 11.5, lineHeight: 1.6, color: "#9a978f", marginTop: "1rem" },
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
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500&family=DM+Mono:wght@400;500&display=swap'); body { margin: 0; }`}</style>
      <div style={c.card} role="dialog" aria-labelledby="gate-title">
        <div style={c.logo}><div style={c.mark}>GT</div><span style={{ fontSize: 15, fontWeight: 500 }}>Gilt Terminal</span></div>
        <h1 id="gate-title" style={c.h1}>For investment professionals only</h1>
        <p style={c.p}>
          Gilt Terminal is a calculator for UK gilt prices and yields. It provides information only. It does not give
          investment, tax or financial advice or personal recommendations, and it is not intended for private (retail) investors.
        </p>
        <p style={{ ...c.p, color: "#1a1916", fontWeight: 500 }}>Please confirm which describes you:</p>

        <div role="radiogroup" aria-label="Your status">
          {STATUSES.map(s => (
            <label key={s.id} style={c.opt(status === s.id)}>
              <input type="radio" name="status" value={s.id} checked={status === s.id}
                onChange={() => { setStatus(s.id); setConfirmed(false); }} style={{ marginTop: 3, accentColor: "#1a6b4a" }} />
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
                style={{ marginTop: 3, accentColor: "#1a6b4a" }} />
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
