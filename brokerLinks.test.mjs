// Broker links (Hargreaves Lansdown, AJ Bell) and the ISINs they are built from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { MASTER } from "./src/giltUniverse.js";
import { brokerLinks, sedolFromIsin, isValidIsin, AJBELL_GILTS_URL } from "./src/brokerLinks.js";

const TODAY = new Date("2026-11-16T00:00:00Z");
const live = MASTER.filter(g => new Date(g.mat) > TODAY);

test("every unmatured gilt has a valid, unique ISIN", () => {
  for (const g of live) {
    assert.ok(g.isin, `${g.sym} has no ISIN`);
    assert.ok(isValidIsin(g.isin), `${g.sym}: ${g.isin} fails the ISIN check digit`);
  }
  assert.equal(new Set(live.map(g => g.isin)).size, live.length);
});

test("ISIN check digit catches a mistyped ISIN", () => {
  assert.ok(isValidIsin("GB00BQC82C90"));
  assert.ok(isValidIsin("GB0002404191"));
  assert.ok(!isValidIsin("GB00BQC82C91"));
  assert.ok(!isValidIsin("GB00BQC28C90"));
  assert.ok(!isValidIsin("BQC82C9"));
});

test("SEDOL is characters 5–11 of a GB ISIN, leading zero kept", () => {
  assert.equal(sedolFromIsin("GB00BQC82C90"), "BQC82C9");
  assert.equal(sedolFromIsin("GB0002404191"), "0240419");
  assert.equal(sedolFromIsin("US0378331005"), null);
});

test("links: HL gilt page and AJ Bell deal page, by SEDOL", () => {
  const ts27 = MASTER.find(g => g.sym === "TS27");
  const l = brokerLinks(ts27);
  assert.equal(l.hl.url, "https://www.hl.co.uk/shares/shares-search-results/BPSNB46");
  assert.equal(l.ajbell.url, "https://www.ajbell.co.uk/platform/trade?marketCode=SEDOL:BPSNB46&instruction=B");
  assert.equal(l.ajbell.listed, true);
});

test("gilts not on AJ Bell's online list link to its gilt price list instead", () => {
  const g = MASTER.find(x => x.isin === "GB00BQC82C90");   // 4¼% 2034
  const l = brokerLinks(g);
  assert.equal(l.ajbell.listed, false);
  assert.equal(l.ajbell.url, AJBELL_GILTS_URL);
  assert.ok(l.hl.url.endsWith("/BQC82C9"));
});

test("a gilt without an ISIN gets no links rather than a broken one", () => {
  assert.equal(brokerLinks({ name: "x", sym: "X" }), null);
  assert.equal(brokerLinks({ name: "x", sym: "X", isin: "GB00BQC82C91" }), null);
});

// Tickers are the keys of the price file: a renamed ticker must be renamed
// in giltUniverse.js, the refresh script's list and the price file together.
import fs from "node:fs";
test("every unmatured gilt has a price under its ticker in the price file", () => {
  const file = JSON.parse(fs.readFileSync(new URL("./public/gilt-prices.json", import.meta.url)));
  const asOf = new Date(file.asOf + "T00:00:00Z");
  const missing = MASTER.filter(g => new Date(g.mat) > asOf && !(g.sym in file.prices)).map(g => g.sym);
  assert.deepEqual(missing, []);
  const refresh = fs.readFileSync(new URL("./scripts/refresh-gilt-prices.js", import.meta.url), "utf8");
  for (const g of MASTER) assert.ok(refresh.includes(`sym: "${g.sym}"`), `${g.sym} missing from the refresh script's list`);
  assert.equal(MASTER.find(g => g.isin === "GB00BQC82C90").sym, "TS34");
});
