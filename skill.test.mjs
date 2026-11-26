// The gilt-ladder Claude Skill: build, input validation, and that the script
// reports exactly what the engine computes, with every payout covered.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { buildSkill } from "./scripts/build-skill.mjs";

const SKILL = new URL("./skill/gilt-ladder/", import.meta.url);
const FIXTURE = new URL("./test-fixtures/gilt-prices-2026-11-04.json", import.meta.url).pathname;
const TODAY = new Date("2026-11-05T12:00:00Z");
let L, engine, MASTER;

before(async () => {
  buildSkill({ zip: false });
  L = await import(new URL("scripts/ladder.mjs", SKILL));
  engine = await import("./src/ladderEngine.js");
  ({ MASTER } = await import("./src/giltUniverse.js"));
});

const ten = (extra = {}) => ({
  liabilities: Array.from({ length: 10 }, (_, i) => ({ date: `${2027 + i}-06`, amount: Math.round(30000 * 1.025 ** (i + 1)) })),
  account: "GIA",
  tax: { rate: 0.4 },
  ...extra,
});
const run = raw => {
  const v = L.validateInput(raw, { today: TODAY });
  assert.ok(v.ok, v.errors.join("; "));
  return L.runLadder(v.input, L.loadPrices(FIXTURE), { today: TODAY });
};
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} got ${a}, want ${b} ±${tol}`);

test("skill package: SKILL.md frontmatter and the built engine are present", () => {
  const md = fs.readFileSync(new URL("SKILL.md", SKILL), "utf8");
  const fm = md.match(/^---\nname: ([a-z0-9-]+)\ndescription: (.+)\n---\n/);
  assert.ok(fm, "frontmatter");
  assert.equal(fm[1], "gilt-ladder");
  assert.ok(fm[2].length <= 1024, `description is ${fm[2].length} chars`);
  for (const f of ["giltMath.js", "ukTax.js", "giltUniverse.js", "ladderEngine.js"]) {
    assert.ok(fs.existsSync(new URL(`scripts/engine/${f}`, SKILL)), f);
    assert.equal(
      fs.readFileSync(new URL(`scripts/engine/${f}`, SKILL), "utf8").split("\n").slice(1).join("\n"),
      fs.readFileSync(new URL(`./src/${f}`, import.meta.url), "utf8"), `${f} is a verbatim copy`);
  }
  assert.ok(fs.existsSync(new URL("data/gilt-prices.json", SKILL)));
});

test("capital and IRR are exactly the engine's (coupon-offset sizing, flat tax)", () => {
  const res = run(ten());
  const f = L.loadPrices(FIXTURE);
  const out = engine.buildLadder({
    liabilities: ten().liabilities, accountType: "GIA", taxRate: 0.4, preference: "lowCoupon",
    settlement: res.meta.settlement, universe: MASTER, prices: f.prices, dirtyPrices: f.dirty,
    dirtySettlement: f.settlement, sizing: "couponOffset", cashNetRate: 0,
  });
  near(res.summary.capitalRequired, out.totals.cost, 1e-9);
  assert.equal(res.summary.portfolioIRR, out.totals.portfolioIRR);
  assert.deepEqual(res.rungs.map(r => r.gilt.epic), out.rungs.map(r => r.gilt.sym));
  assert.equal(res.meta.settlement, "2026-11-06");            // T+1 from Thu 5 Nov
});

for (const [label, extra] of [
  ["flat 40%", {}],
  ["higher band", { tax: { band: "higher" } }],
  ["UK bands from other income", { tax: { otherIncome: 40000, otherSavings: 0 } }],
  ["ISA", { account: "ISA", tax: undefined }],
  ["cash earns 3%", { cashRate: 0.03 }],
]) {
  test(`every payout covered with less than one £100 increment spare — ${label}`, () => {
    const res = run(ten(extra));
    assert.equal(res.summary.allCovered, true, res.warnings.join("; "));
    assert.equal(res.summary.taxSettled, true, res.warnings.join("; "));
    for (const f of res.funding) {
      assert.ok(f.surplus >= -0.005, `${f.needDate} short by ${-f.surplus}`);
      assert.ok(f.surplus < 110, `${f.needDate} over-funded by ${f.surplus}`);
      near(f.available, f.fromRedemptions + f.fromCoupons, 1e-9);
    }
  });
}

test("simple sizing needs more capital than coupon-offset, and both cover", () => {
  const a = run(ten()), b = run(ten({ sizing: "simple" }));
  assert.ok(b.summary.capitalRequired > a.summary.capitalRequired);
  assert.ok(b.summary.allCovered && a.summary.allCovered);
});

test("dealing costs add to capital and lower the IRR", () => {
  const a = run(ten()), b = run(ten({ dealingCosts: { perTrade: 10, percent: 0.1 } }));
  near(b.summary.dealingCosts, 10 * b.summary.gilts + 0.001 * a.summary.capitalRequired, 1e-6);
  assert.ok(b.summary.portfolioIRRIncludingCosts < a.summary.portfolioIRR);
  assert.equal(b.summary.capitalRequired, a.summary.capitalRequired);
});

test("a price override is used and the file's DMO dirty price ignored for it", () => {
  const res = run(ten({ prices: { TS27: 100.5 } }));
  const r = res.rungs.find(x => x.gilt.epic === "TS27");
  near(r.cleanPrice, 100.5, 1e-12);
  near(r.dirtyPrice, 100.5 + r.accrued, 1e-12);
  assert.deepEqual(res.meta.prices.overrides, ["TS27"]);
});

test("stale prices are flagged", () => {
  const v = L.validateInput(ten(), { today: new Date("2026-12-01T12:00:00Z") });
  const res = L.runLadder(v.input, L.loadPrices(FIXTURE), { today: new Date("2026-12-01T12:00:00Z") });
  assert.ok(res.warnings.some(w => /days old/.test(w)));
});

test("input validation catches the usual mistakes", () => {
  const bad = raw => L.validateInput(raw, { today: TODAY }).errors.join(" | ");
  assert.match(bad({ account: "GIA", tax: { rate: 0.4 } }), /liabilities/);
  assert.match(bad(ten({ tax: undefined })), /a GIA needs/);
  assert.match(bad(ten({ tax: { rate: 40 } })), /fraction/);
  assert.match(bad({ ...ten(), liabilities: [{ date: "2026-10", amount: 1000 }] }), /on or before settlement/);
  assert.match(bad({ ...ten(), liabilities: [{ date: "June 2027", amount: 1000 }] }), /YYYY-MM/);
  assert.match(bad({ ...ten(), liabilities: [{ date: "2027-06", amount: -5 }] }), /positive/);
  assert.match(bad(ten({ prices: { XX99: 99 } })), /unknown ticker/);
  assert.match(bad(ten({ account: "LISA" })), /GIA, ISA or SIPP/);
  assert.equal(bad(ten()), "");
});

test("command line: Markdown report, JSON and CSV outputs", () => {
  const dir = fs.mkdtempSync("/tmp/claude-0/skilltest-");
  const input = `${dir}/in.json`;
  fs.writeFileSync(input, JSON.stringify(ten({ clientRef: "Client A" })));
  const md = execFileSync("node", ["scripts/ladder.mjs", input, "--prices", FIXTURE, "--today", "2026-11-05",
    "--json", `${dir}/out.json`, "--csv", `${dir}/out.csv`], { cwd: SKILL.pathname }).toString();
  assert.match(md, /Capital required today/);
  assert.match(md, /as of \*\*2026-11-04\*\*/);
  assert.match(md, /Every payout covered \| Yes \|/);
  const j = JSON.parse(fs.readFileSync(`${dir}/out.json`, "utf8"));
  assert.equal(j.rungs.length, 10);
  assert.equal(fs.readFileSync(`${dir}/out.csv`, "utf8").trim().split("\n").length, 11);
  assert.ok(!/recommend(?!ation or a suitability)|\bbest\b/i.test(md.replace(/not a recommendation/g, "")), "neutral wording");
  // bad input → exit 1 with a message
  fs.writeFileSync(input, JSON.stringify({ liabilities: [] }));
  assert.throws(() => execFileSync("node", ["scripts/ladder.mjs", input], { cwd: SKILL.pathname, stdio: "pipe" }), /Input problems/);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Price source: live site, fallback to the bundled copy, offline ──────────
import http from "node:http";

test("prices: fetched live when the URL works, reported as live", async () => {
  const body = fs.readFileSync(FIXTURE);
  const srv = http.createServer((_, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(body); });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${srv.address().port}/gilt-prices.json`;
  try {
    const p = await L.resolvePrices({ url });
    assert.equal(p.kind, "live");
    assert.equal(p.asOf, "2026-11-04");
    assert.equal(p.note, null);
    const v = L.validateInput(ten(), { today: TODAY });
    const md = L.renderMarkdown(L.runLadder(v.input, p, { today: TODAY }));
    assert.match(md, /as of \*\*2026-11-04\*\* \(live from 127\.0\.0\.1/);
  } finally { srv.close(); }
});

test("prices: unreachable URL falls back to the bundled copy, with a warning in the report", async () => {
  const p = await L.resolvePrices({ url: "http://127.0.0.1:9/gilt-prices.json" });
  assert.equal(p.kind, "bundled");
  assert.match(p.note, /Could not fetch live prices/);
  const v = L.validateInput(ten(), { today: TODAY });
  const res = L.runLadder(v.input, p, { today: TODAY });
  assert.match(res.warnings[0], /Could not fetch live prices.*bundled with the skill/);
  assert.match(L.renderMarkdown(res), /\(bundled with the skill\)/);
});

test("prices: an explicit file or --offline skips the fetch; the build sets the live site URL", async () => {
  assert.equal((await L.resolvePrices({ file: FIXTURE, url: "http://127.0.0.1:9/x" })).kind, "file");
  assert.equal((await L.resolvePrices({ url: "http://127.0.0.1:9/x", offline: true })).kind, "bundled");
  assert.equal(L.configuredPricesUrl(), "https://gilt-terminal.vercel.app/gilt-prices.json");
});
