// Tests for the DMO row parser in scripts/refresh-gilt-prices.js (no network).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGiltRow } from "./scripts/refresh-gilt-prices.js";

test("cum-div row: clean and dirty read in column order", () => {
  const r = parseGiltRow(["3¾% Treasury Gilt 2027", 99.84, 100.462, "GB00BMBL1G81"]);
  assert.deepEqual(r, { name: "3¾% Treasury Gilt 2027", isin: "GB00BMBL1G81", clean: 99.84, dirty: 100.462 });
});

test("ex-div row (dirty < clean) is not swapped", () => {
  const r = parseGiltRow(["4% Treasury Gilt 2029", 98.9, 98.79, "GB00BMF9LG83"]);
  assert.equal(r.clean, 98.9);
  assert.equal(r.dirty, 98.79);
});

test("non-price numbers (e.g. an Excel date serial) are ignored", () => {
  const r = parseGiltRow([46330, "4% Treasury Gilt 2029", "98.90", "98.79", "GB00BMF9LG83"]);
  assert.equal(r.clean, 98.9);
  assert.equal(r.dirty, 98.79);
});

test("header and blank rows are skipped", () => {
  assert.equal(parseGiltRow(["Gilt Name", "Clean Price", "Dirty Price", "ISIN"]), null);
  assert.equal(parseGiltRow([null, null]), null);
});
