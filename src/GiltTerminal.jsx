import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { priceSettlement } from "./giltMath.js";
import { analyseGilts } from "./analyserModel.js";
import LadderView from "./LadderView.jsx";
import PriceEditor from "./PriceEditor.jsx";
import BrokerLinks from "./BrokerLinks.jsx";
import TaxInputs from "./TaxInputs.jsx";
import Segmented from "./Segmented.jsx";
import SettingsPanel from "./SettingsPanel.jsx";
import { s } from "./styles.js";
import { bandHeadroom } from "./ukTax.js";
import BUILD_PRICE_FILE from "../public/gilt-prices.json";

// ── Constants ────────────────────────────────────────────────────────────────

const PRICES_URL_DEFAULT = "/gilt-prices.json";
// Fallback snapshot: the daily price file as it stood when this bundle was
// built. The host rebuilds on every refresh commit, so the snapshot tracks the
// latest DMO data without manual updates. It is used only when the runtime
// fetch of the price file fails. Without live prices the analyser prices
// everything at T+1 after SNAPSHOT_AS_OF, so accrued interest and yields are
// consistent with the snapshot it is labelled with. MASTER px (dated
// MASTER_PX_AS_OF) is the last resort for a gilt missing from the file.
const MASTER_PX_AS_OF = "2026-11-11";
const SNAPSHOT_PRICES = Object.fromEntries(
  Object.entries(BUILD_PRICE_FILE?.prices ?? {})
    .filter(([, px]) => typeof px === "number" && Number.isFinite(px) && px > 0));
const SNAPSHOT_AS_OF =
  Object.keys(SNAPSHOT_PRICES).length && /^\d{4}-\d{2}-\d{2}$/.test(BUILD_PRICE_FILE?.asOf ?? "")
    ? BUILD_PRICE_FILE.asOf : MASTER_PX_AS_OF;
const SNAPSHOT_LABEL = new Date(SNAPSHOT_AS_OF + "T00:00:00Z")
  .toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const STALE_DAYS_WARN = 4;


const VIEWS = [{ value: "analyser", label: "Analyser" }, { value: "ladder", label: "Ladder" }];
const TENORS = [
  { value: "all", label: "All" }, { value: "short", label: "0–5y" },
  { value: "medium", label: "5–15y" }, { value: "long", label: "15y+" },
];
const SORT_OPTS = [["atYTM","After-tax YTM ↓"],["grossYTM","Gross YTM ↓"],["taxDrag","Tax drag ↑"],["maturity","Maturity date ↑"],["cleanPx","Clean price ↑"]];
const SORT_TITLES = { atYTM: "after-tax yield to maturity", grossYTM: "gross yield to maturity", taxDrag: "tax drag, lowest first", maturity: "maturity date", cleanPx: "clean price, lowest first" };

const gbp = n => "£" + Math.round(n).toLocaleString("en-GB");
const gbpShort = n => (n == null ? "—" : n >= 1e6 ? `£${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}m` : gbp(n));

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

// ── Sub-components ────────────────────────────────────────────────────────────
// Floating status: sits over the content instead of pushing the table down.
function Notice({ type, children, onDismiss }) {
  const icons = { info: "i", warn: "!", ok: "✓" };
  return (
    <div className="gt-toast" data-type={type} role={type === "warn" ? "alert" : "status"}>
      <span className="gt-toast-icon" aria-hidden="true">{icons[type]}</span>
      <span style={{ flex: 1 }}>{children}</span>
      {onDismiss && <button type="button" className="gt-toast-close" onClick={onDismiss} aria-label="Dismiss">✕</button>}
    </div>
  );
}

function SummaryCards({ data, taxRate, taxProfile }) {
  const head = taxProfile ? bandHeadroom(taxProfile) : null;
  const solved = data.filter(g => g.at != null && g.drag != null);
  const best = solved.reduce((b, g) => (!b || g.at > b.at ? g : b), null);
  const avgDrag = solved.length ? solved.reduce((s, g) => s + g.drag, 0) / solved.length : 0;
  return (
    <div className="gt-cards" style={s.cards}>
      <div style={s.card}>
        <div style={s.cardLbl}>Gilts shown</div>
        <div style={{ ...s.cardVal, color: "var(--accent)" }}>{data.length}</div>
        <div style={s.cardSub}>conventional gilts</div>
      </div>
      <div style={s.card}>
        <div style={s.cardLbl}>Highest after-tax YTM</div>
        <div style={{ ...s.cardVal, color: "var(--accent)" }}>{best ? best.at.toFixed(3) + "%" : "—"}</div>
        <div style={{ ...s.cardSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{best ? best.name.replace(" Treasury", "").replace(" Stock", "").trim() : "—"}</div>
      </div>
      <div style={s.card}>
        <div style={s.cardLbl}>Avg tax drag</div>
        <div style={{ ...s.cardVal, color: "var(--neg)" }}>{solved.length ? `-${avgDrag.toFixed(2)}%` : "—"}</div>
        <div style={s.cardSub}>gross minus after-tax</div>
      </div>
      <div style={s.card}>
        <div style={s.cardLbl}>{head ? "Gilt interest before higher rate" : "Tax rate applied"}</div>
        <div style={{ ...s.cardVal, color: "var(--accent)" }}>{head ? gbp(head.toThreshold) : `${Math.round(taxRate * 100)}%`}</div>
        <div style={s.cardSub}>{head ? `a year: ${gbp(head.nil)} at 0%, ${gbp(head.basic)} at basic rate` : "coupons taxable; gains exempt"}</div>
      </div>
    </div>
  );
}

function GiltTable({ data, isLive, liveOverrides, manual, setManual, taxRate, banded }) {
  const [editing, setEditing] = useState(null);
  const nCols = banded ? 15 : 13;
  const solvedAt = data.filter(g => g.at != null).map(g => g.at);
  const maxAt = solvedAt.length ? Math.max(...solvedAt) : 1;
  const unsolved = data.filter(g => g.at == null || g.grossYTM == null);
  const pctFmt = v => (v == null ? "—" : v.toFixed(3) + "%");
  const now = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div style={s.panel}>
      <div className="gt-tblWrap" style={s.tblWrap}>
        <table className="gt-table gt-analyser-table" style={{ width: "100%", borderCollapse: "collapse" }}>
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
                ...(banded ? [["Coupon tax ▲", true], ["Fills basic band ▲", true]] : []),
                ["Tax Drag",         true],
                ["Type",             true],
                ["Relative",         true],
              ].map(([h, right]) => (
                <th key={h} style={right ? s.thR : s.th} title={
                  h === "Deposit Equiv. ▲"
                    ? (banded
                      ? "Gross rate a fully-taxable deposit of the same amount would need to match this gilt's after-tax return, with the deposit's interest taxed by the same bands."
                      : "Gross yield a fully-taxable deposit would need to match this gilt's after-tax return: after-tax YTM ÷ (1 − tax rate).")
                    : h === "Coupon tax ▲"
                    ? "Income tax on this gilt's coupons over its life as a share of the taxable interest, for the amount entered, on top of the other income entered. Hover a figure for the yearly interest and tax."
                    : h === "Fills basic band ▲"
                    ? "What a holding of this gilt alone would cost when a full year of its coupons takes income exactly to the £50,270 higher-rate threshold. Coupons on a larger holding start to be taxed at the higher rate. A calculation, not a suggested amount."
                    : h === "Gilt"
                    ? "HL and AJ Bell links open the gilt at that broker. Gilt Terminal isn't affiliated with either, receives nothing from them and places no trades; the links are not a recommendation to deal."
                    : h === "Clean £"
                    ? "Click ✎ to enter a live price for a one-off check (not saved)."
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
                <td colSpan={nCols} style={{ ...s.tdBase, background: "var(--warn-soft)", color: "var(--warn)", fontSize: "0.75rem" }}>
                  ⚠ No yield between −50% and 100% reprices {unsolved.map(g => g.sym).join(", ")} at the
                  current price and accrued interest — shown as "—". Check the price before relying on it.
                </td>
              </tr>
            )}
            {data.map((g, i) => {
              const matLbl = new Date(g.mat).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
              const pct = g.at != null ? Math.max(0, (g.at / maxAt) * 100).toFixed(1) : "0";
              const dPxCls = g.dPx > 0.005 ? "var(--accent)" : g.dPx < -0.005 ? "var(--neg)" : "var(--text-3)";
              const dPxTxt = isLive ? (g.dPx > 0.005 ? `+${g.dPx.toFixed(2)}` : g.dPx < -0.005 ? g.dPx.toFixed(2) : "—") : "—";
              const td = (content, right = false, extra = {}) => (
                <td style={{ ...(right ? s.tdR : s.tdBase), ...extra }}>{content}</td>
              );
              const isManual = g.priceSource === "manual";
              const settleLbl = g.settlement.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
              return (
                <Fragment key={g.sym}>
                <tr className="gt-row">
                  {td(<span style={{ fontFamily: "var(--font-num)", fontSize: "0.6875rem", color: "var(--text-3)" }}>{i + 1}</span>)}
                  {td(<>
                    <span style={{ fontSize: "0.8125rem", color: "var(--text)", maxWidth: 195, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{g.name}</span>
                    <span className="gt-mobile-only" style={{ fontSize: "0.6875rem", color: "var(--text-3)" }}>matures {matLbl}</span>
                    <span style={{ display: "block", marginTop: 3 }}><BrokerLinks gilt={g} /></span>
                  </>)}
                  {td(<span style={{ fontFamily: "var(--font-num)", color: "var(--text-3)" }}>{g.c.toFixed(3)}%</span>, true)}
                  {td(<span style={{ color: "var(--text-3)" }}>{matLbl}</span>, true)}
                  {td(<span style={{ color: "var(--text-3)", fontSize: "0.75rem" }}>{g.yrs.toFixed(1)}y</span>, true)}
                  {td(
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                      {isManual && (
                        <span style={s.manualBadge}
                          title={`Your price (${g.manual.kind} ${g.manual.input}), entered ${new Date(g.manual.enteredAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}, priced for settlement ${settleLbl}. One-off — not saved.`}>
                          live
                        </span>
                      )}
                      <span style={{ fontFamily: "var(--font-num)", fontWeight: isManual ? 500 : 400 }}>£{g.cp.toFixed(2)}</span>
                      <button style={s.editBtn} onClick={() => setEditing(e => (e === g.sym ? null : g.sym))}
                        title="Enter a live price for this gilt (one-off)" aria-label={`Edit price for ${g.name}`}>✎</button>
                    </span>, true)}
                  {td(<span style={{ fontFamily: "var(--font-num)", fontSize: "0.6875rem", color: dPxCls }}>{dPxTxt}</span>, true)}
                  {td(<span style={{ fontFamily: "var(--font-num)", fontSize: "0.75rem", color: "var(--text-3)" }}>{pctFmt(g.grossYTM)}</span>, true)}
                  {td(<strong style={{ fontFamily: "var(--font-num)", fontSize: "0.875rem", fontWeight: 500, color: "var(--accent)" }}>{pctFmt(g.at)}</strong>, true)}
                  {td(<strong style={{ fontFamily: "var(--font-num)", fontSize: "0.8125rem", fontWeight: 500, color: "var(--info)" }}>{pctFmt(g.gey)}</strong>, true)}
                  {banded && td(
                    <span style={{ fontFamily: "var(--font-num)", fontSize: "0.75rem", color: "var(--text-2)", cursor: "help" }}
                      title={`${gbp(g.bands.nominal)} nominal pays ${gbp(g.bands.annualInterest)} a year in coupons.\n` +
                        g.bands.byYear.slice(0, 6).map(y => `${y.label}: ${gbp(y.interest)} taxable, ${gbp(y.tax)} tax (${(y.rate * 100).toFixed(1)}%)`).join("\n") +
                        (g.bands.byYear.length > 6 ? `\n… ${g.bands.byYear.length - 6} more years` : "")}>
                      {(g.bands.effRate * 100).toFixed(1)}%
                    </span>, true)}
                  {banded && td(
                    <span style={{ fontFamily: "var(--font-num)", fontSize: "0.75rem", color: "var(--text-2)" }}
                      title={g.bands.basicCost ? `0% headroom alone: ${gbpShort(g.bands.nilCost)} of this gilt` : undefined}>
                      {g.bands.basicCost ? gbpShort(g.bands.basicCost) : "—"}
                    </span>, true)}
                  {td(<span style={{ fontFamily: "var(--font-num)", fontSize: "0.75rem", color: "var(--neg)" }}>{g.drag == null ? "—" : `-${g.drag.toFixed(2)}%`}</span>, true)}
                  {td(
                    <span style={{ display: "inline-block", fontSize: "0.6875rem", fontWeight: 500, padding: "2px 7px", borderRadius: 12, letterSpacing: "0.03em", ...(g.couponType === "low" ? { background: "var(--info-soft)", color: "var(--info)" } : { background: "var(--warn-soft)", color: "var(--warn)" }) }}>
                      {g.couponType}
                    </span>, true
                  )}
                  {td(
                    <div style={{ width: 60 }}>
                      <div style={{ background: "var(--track)", height: 3, borderRadius: 2, overflow: "hidden" }}>
                        <div style={{ width: `${pct}%`, height: "100%", background: "var(--accent)", borderRadius: 2 }} />
                      </div>
                    </div>, true
                  )}
                </tr>
                {editing === g.sym && (
                  <PriceEditor gilt={g} colSpan={nCols} taxRate={g.bands?.rateAt ?? taxRate}
                    referenceClean={liveOverrides[g.sym] ?? g.px}
                    current={manual[g.sym] ?? null}
                    onApply={m => setManual(prev => ({ ...prev, [g.sym]: m }))}
                    onClear={() => setManual(prev => { const { [g.sym]: _, ...rest } = prev; return rest; })}
                    onClose={() => setEditing(null)} />
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={s.ts}>
        <span>{isLive ? "Live · UK DMO daily reference prices" : `Cached · snapshot ${SNAPSHOT_LABEL}`}</span>
        <span>{now}</span>
      </div>
    </div>
  );
}

// ── Methodology note ──────────────────────────────────────────────────────────
function MethodologyNote({ taxRate, settlement, banded }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        style={s.btnRefresh} aria-expanded={open}
      >
        Methodology <span aria-hidden="true" style={{ fontSize: "0.6875rem", color: "var(--text-3)" }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="gt-reveal" style={{ ...s.methodBox, marginTop: 8 }}>
          <strong style={{ color: "var(--text)" }}>After-tax YTM</strong> — solved by bisection on the IRR of
          after-tax cash flows using the exact future coupon schedule. Following the DMO yield
          formula, cash flows are discounted in coupon periods (days to next coupon ÷ days in the
          current period, then whole half-years) with semi-annual compounding, so gross YTM is
          comparable with DMO and Bloomberg yields. Yields are semi-annual (s.a.); the
          annual-effective equivalent is (1 + y/2)² − 1.
          Coupon income is taxed {banded ? "by band on top of the other income entered (below)" : `at ${Math.round(taxRate * 100)}%`}; the redemption gain (£100 − clean price) is
          CGT-exempt under TCGA 1992 s.115. Accrued income scheme: on a cum-dividend purchase
          only the portion of the first coupon accruing <em>after</em> purchase is taxed (relief
          for the accrued interest paid); on an ex-dividend purchase the next coupon goes to the
          seller and the buyer is taxed on the rebate interest (HMRC SAIM4150).
          <br /><br />
          <strong style={{ color: "var(--text)" }}>Tax from other income</strong> — instead of one flat
          rate, the amount entered is put into each gilt on its own, its taxable interest is added up
          per tax year and taxed as savings income on top of the other income entered: personal
          allowance (£12,570, tapered above £100,000), starting rate for savings (up to £5,000 at 0%,
          reduced by non-savings income above the allowance), personal savings allowance
          (£1,000 / £500 / nil), basic rate to £50,270, higher rate to £125,140. Savings rates are
          20/40/45% in 2026/27 and 24/44/49% from 6 April 2027; thresholds are held at today's
          figures and other income is assumed the same every year. The tax is the increase caused by
          the gilt interest, so it includes a smaller savings allowance once income crosses £50,270.
          Dividends, Scottish rates on other income and the High Income Child Benefit Charge are not
          modelled. <em>Fills basic band</em> is the cost of the holding whose full-year coupons take
          income exactly to £50,270.
          <br /><br />
          <strong style={{ color: "var(--text)" }}>Settlement</strong> — accrued interest and yields are
          for settlement on {settlement.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })},
          the next business day after the price date (T+1), using the DMO clean reference price.
          <br /><br />
          <strong style={{ color: "var(--text)" }}>Accrued interest</strong> — Actual/Actual day count
          (days elapsed ÷ actual days in coupon period), per UK gilt convention. Within 7 business
          days of a coupon the gilt trades ex-dividend and accrued interest is negative.
          <br /><br />
          <strong style={{ color: "var(--text)" }}>Deposit Equiv.</strong> — the gross yield a fully-taxable
          deposit or bond would need to match this gilt's after-tax return.
          Formula: <code>after-tax YTM ÷ (1 − tax rate)</code> — a deposit paying that gross rate
          keeps exactly the gilt's after-tax yield once its interest is taxed.
          <br /><br />
          <strong style={{ color: "var(--text)" }}>Your live prices (✎)</strong> — a price you type in is
          treated as today's dealing price, so it settles T+1 from today: accrued interest and
          ex-dividend status are taken at that date (a dirty price is converted to clean the same
          way), and the DMO file's dirty price is not used for that gilt. One-off: not saved,
          cleared on reload.
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
  const [updateStamp, setUpdateStamp] = useState(`Prices: snapshot ${SNAPSHOT_LABEL}`);
  const [asOf, setAsOf] = useState(null);
  const [liveDirty, setLiveDirty] = useState({});
  // One-off manual prices ({ [sym]: makeManualPrice result }): page memory
  // only — never persisted, never in the URL, gone on reload.
  const [manual, setManual] = useState({});
  const [dirtySettlement, setDirtySettlement] = useState(null);
  const [view, setView] = useState(() =>
    typeof window !== "undefined" && window.location.hash.startsWith("#ladder") ? "ladder" : "analyser");

  // Band-based tax inputs: page memory only — never persisted, never in the URL.
  const [taxMode, setTaxMode] = useState("flat");
  const [income, setIncome] = useState("30000");
  const [otherSavings, setOtherSavings] = useState("0");
  const [holding, setHolding] = useState("100000");
  const banded = taxMode === "bands";
  const profile = useMemo(() => ({
    otherIncome: Math.max(0, Number(income) || 0),
    otherSavings: Math.max(0, Number(otherSavings) || 0),
  }), [income, otherSavings]);
  const tax = { mode: taxMode, setMode: setTaxMode, taxRate, setTaxRate, income, setIncome,
    otherSavings, setOtherSavings, holding, setHolding, profile };
  const analyserProfile = banded && Number(holding) > 0 ? { ...profile, amount: Number(holding) } : null;

  const settlement = useMemo(() => priceSettlement(isLive && asOf ? asOf : SNAPSHOT_AS_OF), [isLive, asOf]);
  const dirtyHere = isLive && dirtySettlement === settlement.toISOString().slice(0, 10) ? liveDirty : {};
  // Clean prices in force: the fetched file, else the build-time snapshot.
  const basePrices = isLive ? liveOverrides : SNAPSHOT_PRICES;
  const data = analyseGilts({
    prices: basePrices, isLive, taxRate, settlement, liveDirty: dirtyHere, manual,
    taxProfile: analyserProfile,
  });
  const manualSyms = Object.keys(manual);
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
      setUpdateStamp(`Snapshot ${SNAPSHOT_LABEL}`);
      setNotice({
        type: "warn",
        msg: `Couldn't load the daily price file (${err.message || err}). Showing ${SNAPSHOT_LABEL} snapshot.`,
      });
    }
    setRefreshing(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // The header's edge only appears once content scrolls underneath it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 2);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
      <div className="gt-wrap">
        <header className="gt-header" data-scrolled={scrolled}>
          <div className="gt-brand">
            <div className="gt-mark">GT</div>
            <span className="gt-title">Gilt Terminal</span>
            <span className="gt-logoSub">after-tax yield analyser</span>
          </div>
          <Segmented ariaLabel="View" options={VIEWS} value={view}
            onChange={v => {
              setView(v);
              if (v === "analyser") window.history.replaceState(null, "", window.location.pathname);
            }} />
          <div className="gt-hdrRight">
            <span className="gt-stamp">
              {isLive && <span className="gt-dot" title="Live: daily price file loaded" />}
              {updateStamp}
            </span>
            <button style={s.btnRefresh} onClick={refresh} disabled={refreshing} aria-label="Refresh prices">
              <span aria-hidden="true" style={{ display: "inline-block", width: 14, textAlign: "center", animation: refreshing ? "spin 0.7s linear infinite" : "none" }}>↻</span>
              <span className="gt-btn-label">Refresh</span>
            </button>
          </div>
        </header>

        {notice && (
          <Notice key={notice.msg} type={notice.type} onDismiss={() => setNotice(null)}>{notice.msg}</Notice>
        )}

        <div className="gt-infoBar" role="note">
          <strong style={{ fontWeight: 600, color: "var(--text-2)" }}>Information only — not advice or a personal recommendation.</strong>{" "}
          For investment professionals. A personal project: not operated by or on behalf of any FCA-authorised firm, and not a
          regulated service. Figures are calculations from published prices, which may be stale or wrong — check before relying
          on them. Tax treatment depends on individual circumstances and may change. No affiliation with Hargreaves Lansdown or
          AJ Bell; links are for convenience only.
        </div>

        {manualSyms.length > 0 && (
          <div className="gt-manualBar">
            <span>
              ✎ Your live price{manualSyms.length > 1 ? "s" : ""} in use for <strong>{manualSyms.join(", ")}</strong> — in the
              analyser and the ladder, this visit only (not saved; cleared on reload).
            </span>
            <button style={s.btn} onClick={() => setManual({})}>Clear all</button>
          </div>
        )}

        {/* Body */}
        {view === "ladder" ? (
          <LadderView taxRate={taxRate} taxProfile={banded ? profile : null}
            taxInputs={<TaxInputs tax={tax} />}
            liveOverrides={basePrices} isLive={isLive} asOf={asOf} snapshotLabel={SNAPSHOT_LABEL}
            liveDirty={liveDirty} dirtySettlement={dirtySettlement}
            manual={manual} setManual={setManual} />
        ) : (
        <div className="gt-layout">
          <SettingsPanel label="Tax, filters & data">
            <div>
              <div style={s.secLbl}>Tax parameters</div>
              <TaxInputs tax={tax} showHolding />
              <div style={{ fontSize: "0.75rem", color: "var(--text-2)", marginBottom: 4 }}>CGT on gilt gains</div>
              <div style={{ fontFamily: "var(--font-num)", fontSize: "0.75rem", fontWeight: 500, color: "var(--accent)" }}>0% — fully exempt</div>
            </div>

            <hr style={s.hr} />

            <div>
              <div style={s.secLbl}>Filters</div>
              {[
                { label: "Maturity range", val: matFilter, set: setMatFilter, opts: [["all","All maturities"],["short","0 – 5 years"],["medium","5 – 15 years"],["long","15+ years"]] },
                { label: "Coupon type", val: couponFilter, set: setCouponFilter, opts: [["all","All coupons"],["low","Low coupon (≤ 2%)"],["high","High coupon (> 2%)"]] },
                { label: "Sort by", val: sortBy, set: setSortBy, opts: SORT_OPTS },
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

            <div style={{ fontSize: "0.75rem", color: "var(--text-2)", lineHeight: 1.75 }}>
              <div style={s.secLbl}>Data source</div>
              <strong style={{ color: "var(--text)" }}>Live:</strong> UK DMO daily reference prices<br />
              <strong style={{ color: "var(--text)" }}>Fallback:</strong> snapshot {SNAPSHOT_LABEL}<br />
              <span style={{ color: "var(--text-3)", fontSize: "0.6875rem" }}>
                Refreshed each weekday after LSE close by GitHub Action.
                AI uses Actual/Actual day count. YTM uses exact coupon schedule.
                {asOf && <> Last refresh: <strong style={{ color: "var(--text)" }}>{asOf}</strong>.</>}
              </span>
            </div>

            <div style={s.sbFoot}>
              Information only — not advice. Verify prices before dealing.<br />
              <a href="https://giltsyield.com" target="_blank" rel="noreferrer" style={{ color: "var(--info)" }}>giltsyield.com</a>
              {" · "}
              <a href="https://www.dmo.gov.uk" target="_blank" rel="noreferrer" style={{ color: "var(--info)" }}>dmo.gov.uk</a>
            </div>
          </SettingsPanel>

          <main className="gt-main">
            <SummaryCards data={filtered} taxRate={taxRate} taxProfile={analyserProfile} />

            <div style={s.panel}>
              <div className="gt-panelHdr" style={s.panelHdr}>
                <span style={s.panelTtl}>Sorted by {SORT_TITLES[sortBy]}</span>
                <Segmented ariaLabel="Maturity range" size="sm" options={TENORS} value={matFilter} onChange={setMatFilter} />
              </div>
              {filtered.length > 0
                ? <GiltTable data={filtered} isLive={isLive} liveOverrides={basePrices}
                    manual={manual} setManual={setManual} taxRate={taxRate} banded={!!analyserProfile} />
                : <div style={{ padding: "3rem 2rem", textAlign: "center", color: "var(--text-3)" }}>No gilts match the current filters.</div>
              }
            </div>

            <MethodologyNote taxRate={taxRate} settlement={settlement} banded={!!analyserProfile} />
          </main>
        </div>
        )}
      </div>
  );
}
