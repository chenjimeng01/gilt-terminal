import { bandHeadroom, HIGHER_RATE_THRESHOLD } from "./ukTax.js";

const mono = { fontFamily: "DM Mono, monospace" };
const row = { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12, color: "#5a5750", marginBottom: 4 };
const val = { ...mono, fontSize: 12, fontWeight: 500, color: "#1a6b4a" };
const input = { background: "#fff", border: "1px solid #e0deda", borderRadius: 6, color: "#1a1916", ...mono, fontSize: 13, padding: "7px 10px", width: "100%", outline: "none" };
const seg = on => ({
  flex: 1, fontSize: 11, padding: "5px 6px", cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
  border: "1px solid " + (on ? "rgba(26,107,74,.18)" : "#e0deda"), borderRadius: 6,
  background: on ? "#e8f5ef" : "#fff", color: on ? "#1a6b4a" : "#9a978f", fontWeight: on ? 500 : 400,
});
const gbp = n => "£" + Math.round(n).toLocaleString("en-GB");

/**
 * Coupon-tax inputs shared by the analyser and ladder sidebars: either the
 * flat rate slider, or the person's other income, from which the tax on gilt
 * interest is worked out band by band (ukTax.js).
 *
 * `tax` = { mode, setMode, taxRate, setTaxRate, income, setIncome,
 *           otherSavings, setOtherSavings, holding, setHolding, profile }
 * `showHolding`: the analyser needs an amount per gilt; the ladder sizes its own.
 */
export default function TaxInputs({ tax, showHolding = false }) {
  const bands = tax.mode === "bands";
  const head = bands ? bandHeadroom(tax.profile) : null;
  const field = (label, title, value, set, step = 1000) => (
    <div style={{ marginBottom: "0.6rem" }}>
      <div style={{ ...row, marginBottom: 3 }}><span title={title}>{label} ▲</span></div>
      <input type="number" min={0} step={step} style={input} value={value}
        onChange={e => set(e.target.value)} aria-label={label} />
    </div>
  );
  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: "0.7rem" }} role="group" aria-label="How coupon tax is worked out">
        <button style={seg(!bands)} onClick={() => tax.setMode("flat")}>Flat rate</button>
        <button style={seg(bands)} onClick={() => tax.setMode("bands")}>From other income</button>
      </div>
      {!bands ? (
        <div style={{ marginBottom: "0.7rem" }}>
          <div style={row}>
            <span>Income tax rate</span>
            <span style={val}>{Math.round(tax.taxRate * 100)}%</span>
          </div>
          <input type="range" min={0} max={60} step={5} value={Math.round(tax.taxRate * 100)}
            onChange={e => tax.setTaxRate(parseInt(e.target.value) / 100)}
            style={{ width: "100%", height: 3, accentColor: "#1a6b4a", cursor: "pointer" }} />
        </div>
      ) : (
        <>
          {field("Other income £ a year",
            "Salary, pensions, rent and profits for the tax year, before tax. Not interest or dividends. Assumed the same every year.",
            tax.income, tax.setIncome)}
          {field("Other savings interest £ a year",
            "Interest from bank accounts and other bonds outside ISAs. It uses the allowances first; the gilt interest is taxed on top.",
            tax.otherSavings, tax.setOtherSavings, 100)}
          {showHolding && field("Amount in each gilt £",
            "Each gilt is shown as if this amount were put into that gilt alone, since the tax depends on how much interest it pays.",
            tax.holding, tax.setHolding, 10000)}
          <div style={{ fontSize: 11.5, color: "#5a5750", lineHeight: 1.7, background: "#f2f1ee", border: "1px solid #e0deda", borderRadius: 6, padding: "7px 9px", marginBottom: "0.7rem" }}>
            Gilt interest a year, on top of that income:
            <div style={row}><span>at 0%</span><span style={val}>first {gbp(head.nil)}</span></div>
            <div style={row}><span>at basic rate</span><span style={val}>next {gbp(head.basic)}</span></div>
            <div style={{ ...row, marginBottom: 0 }}><span>higher rate from</span><span style={val}>{gbp(head.toThreshold)}</span></div>
            <div style={{ color: "#9a978f", fontSize: 10.5, marginTop: 4, lineHeight: 1.5 }}>
              Personal allowance, starting rate for savings and personal savings allowance, then the basic
              rate band to {gbp(HIGHER_RATE_THRESHOLD)}. Savings rates 20/40/45%, 24/44/49% from 6 Apr 2027.
              Not saved or shared.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
