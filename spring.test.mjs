import { test } from "node:test";
import assert from "node:assert/strict";
import { springCoefficients, stepSpring, project, rubberband, releaseVelocity } from "./src/spring.js";

const run = (x, v, target, seconds, cfg, each) => {
  for (let i = 0; i < seconds * 60; i++) {
    [x, v] = stepSpring(x, v, target, 1 / 60, cfg);
    each?.(x, v);
  }
  return [x, v];
};

test("a critically damped spring settles on the target without overshoot", () => {
  const cfg = springCoefficients(0.35, 1);
  let max = -Infinity;
  const [x, v] = run(0, 0, 100, 1.5, cfg, x => { max = Math.max(max, x); });
  assert.ok(Math.abs(x - 100) < 0.01, `x=${x}`);
  assert.ok(Math.abs(v) < 0.1, `v=${v}`);
  assert.ok(max <= 100.0001, `overshot to ${max}`);
});

test("an under-damped spring overshoots a little, then settles", () => {
  const cfg = springCoefficients(0.3, 0.8);
  let max = -Infinity;
  const [x] = run(0, 0, 100, 2, cfg, x => { max = Math.max(max, x); });
  assert.ok(max > 100.5 && max < 110, `max=${max}`);
  assert.ok(Math.abs(x - 100) < 0.01);
});

test("re-targeting mid-flight continues from the live value and velocity", () => {
  const cfg = springCoefficients(0.35, 1);
  const [x0, v0] = run(0, 0, 100, 0.1, cfg);
  assert.ok(x0 > 0 && x0 < 100 && v0 > 0);
  // Reverse: the very next frame still moves forward (no velocity cut), then turns.
  const [x1] = stepSpring(x0, v0, 0, 1 / 240, cfg);
  assert.ok(x1 > x0, "velocity was discarded at the reversal");
  const [x2] = run(x0, v0, 0, 1.5, cfg);
  assert.ok(Math.abs(x2) < 0.01);
});

test("release velocity is handed to the spring", () => {
  const cfg = springCoefficients(0.3, 1);
  const [x] = stepSpring(50, 600, 150, 1 / 60, cfg);
  assert.ok(x - 50 > 600 / 60 * 0.8, "first frame should travel at about the release velocity");
});

test("project matches scroll-style exponential decay", () => {
  assert.ok(Math.abs(project(1000) - 499) < 0.5);
  assert.ok(Math.abs(project(1000, 0.99) - 99) < 0.5);
  assert.equal(project(0), 0);
  assert.equal(project(-500), -project(500));
});

test("rubberband resists progressively and never exceeds the pull", () => {
  let prev = 0, prevGain = Infinity;
  for (const pull of [10, 50, 100, 200, 400, 800]) {
    const out = rubberband(pull, 500);
    assert.ok(out > prev && out < pull);
    assert.ok(out / pull < prevGain, "resistance should grow with distance");
    prev = out; prevGain = out / pull;
  }
  assert.ok(rubberband(1e9, 500) <= 500);
  assert.equal(rubberband(-100, 500), -rubberband(100, 500));
});

test("releaseVelocity uses only the last moments of the gesture", () => {
  const samples = [{ t: 0, v: 0 }, { t: 500, v: 10 }, { t: 550, v: 60 }, { t: 600, v: 110 }];
  assert.equal(releaseVelocity(samples, 600), 1000);
  assert.equal(releaseVelocity(samples, 900), 0); // finger rested before lifting
  assert.equal(releaseVelocity([{ t: 0, v: 0 }], 0), 0);
});
