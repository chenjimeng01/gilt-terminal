// Entry gate rules.
import { test } from "node:test";
import assert from "node:assert/strict";
import { STATUSES, mayEnter, readCertified, writeCertified, GATE_KEY } from "./src/accessGate.js";

const store = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test("the four statuses, in order, with only Other refused", () => {
  assert.deepEqual(STATUSES.map(s => s.label), ["Financial Adviser", "Professional Investor", "Institutional Investor", "Other"]);
  assert.deepEqual(STATUSES.filter(s => !s.allowed).map(s => s.id), ["other"]);
});

test("entry needs a permitted status AND the confirmation", () => {
  for (const id of ["adviser", "professional", "institutional"]) {
    assert.equal(mayEnter(id, true), true);
    assert.equal(mayEnter(id, false), false);
    assert.equal(mayEnter(id, undefined), false);
  }
  assert.equal(mayEnter("other", true), false);
  assert.equal(mayEnter(null, true), false);
  assert.equal(mayEnter("retail", true), false);
});

test("stored certification: only permitted statuses are written or honoured", () => {
  const s = store();
  writeCertified(s, "other"); assert.equal(s.getItem(GATE_KEY), null);
  writeCertified(s, "adviser"); assert.equal(readCertified(s), "adviser");
  assert.equal(readCertified(store({ [GATE_KEY]: "other" })), null);
  assert.equal(readCertified(store({ [GATE_KEY]: "true" })), null);
  assert.equal(readCertified(null), null);
  assert.equal(readCertified({ getItem() { throw new Error("blocked"); } }), null);
});
