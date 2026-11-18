import Segmented from "./Segmented.jsx";
import { s } from "./styles.js";
import { bandHeadroom, HIGHER_RATE_THRESHOLD } from "./ukTax.js";

const row = s.fieldRow;
const val = s.fieldVal;
const input = s.inputEl;
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
      <div style={{ marginBottom: "0.8rem" }}>
        <Segmented ariaLabel="How coupon tax is worked out" size="sm" stretch value={tax.mode} onChange={tax.setMode}
          options={[{ value: "flat", label: "Flat rate" }, { value: "bands", label: "From other income" }]} />
      </div>
      {!bands ? (
        <div style={{ marginBottom: "0.7rem" }}>
          <div style={row}>
            <span>Income tax rate</span>
            <span style={val}>{Math.round(tax.taxRate * 100)}%</span>
          </div>
          <input type="range" min={0} max={60} step={5} value={Math.round(tax.taxRate * 100)}
            onChange={e => tax.setTaxRate(parseInt(e.target.value) / 100)}
            aria-label="Income tax rate" style={{ width: "100%", cursor: "pointer" }} />
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
          <div style={{ fontSize: "0.7188rem", color: "var(--text-2)", lineHeight: 1.7, background: "var(--fill)", borderRadius: 10, padding: "9px 11px", marginBottom: "0.7rem" }}>
            Gilt interest a year, on top of that income:
            <div style={row}><span>at 0%</span><span style={val}>first {gbp(head.nil)}</span></div>
            <div style={row}><span>at basic rate</span><span style={val}>next {gbp(head.basic)}</span></div>
            <div style={{ ...row, marginBottom: 0 }}><span>higher rate from</span><span style={val}>{gbp(head.toThreshold)}</span></div>
            <div style={{ color: "var(--text-3)", fontSize: "0.6875rem", marginTop: 4, lineHeight: 1.5 }}>
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
