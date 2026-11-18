// Motion primitives for gesture-driven UI: a spring that can be grabbed and
// re-targeted mid-flight, momentum projection and rubber-banding.
//
// Springs are described the way a designer thinks about them:
//   response — roughly how long the value takes to reach the target, seconds
//   damping  — damping ratio: 1 settles with no overshoot, below 1 bounces
// A spring has no fixed duration; a new target or a new velocity simply
// continues the motion from wherever the value is on screen.

/** Stiffness and damping coefficients (unit mass) for a response/damping pair. */
export function springCoefficients(response, damping) {
  const omega = (2 * Math.PI) / response;
  return { k: omega * omega, c: 2 * damping * omega };
}

/** Advance a spring by dt seconds. Returns the new [value, velocity]. */
export function stepSpring(x, v, target, dt, { k, c }) {
  // Semi-implicit Euler in sub-steps of at most 2ms: stable for UI springs.
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(left, 0.002);
    v += (-k * (x - target) - c * v) * h;
    x += v * h;
    left -= h;
  }
  return [x, v];
}

/**
 * Where a value released at `velocity` (units per second) would come to rest
 * under scroll-style exponential decay. Add it to the current position and
 * snap to the target nearest that point, so a flick throws the element.
 */
export function project(velocity, decelerationRate = 0.998) {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Progressive resistance past a boundary: follows less the further you pull. */
export function rubberband(overshoot, dimension, constant = 0.55) {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Velocity (units per second) over the last `windowMs` of [{ t, v }] samples. */
export function releaseVelocity(samples, now, windowMs = 100) {
  const recent = samples.filter(p => now - p.t <= windowMs);
  if (recent.length < 2) return 0;
  const a = recent[0], b = recent[recent.length - 1];
  return b.t - a.t < 1 ? 0 : ((b.v - a.v) / (b.t - a.t)) * 1000;
}

/**
 * A spring driven by requestAnimationFrame.
 *   to(target, { velocity, response, damping })  animate from the live value;
 *        velocity is carried over from the motion in progress unless given
 *   jump(value)   set the value with no animation (1:1 tracking during a drag)
 *   stop()        freeze where it is, e.g. when the user grabs it
 */
export function createSpring({ value = 0, response = 0.35, damping = 1, precision = 0.01, onUpdate, onRest } = {}) {
  let x = value, v = 0, target = value;
  let coeff = springCoefficients(response, damping);
  let raf = 0, last = 0;

  const tick = now => {
    const dt = Math.min(0.064, Math.max(0, (now - last) / 1000));
    last = now;
    [x, v] = stepSpring(x, v, target, dt, coeff);
    if (Math.abs(x - target) < precision && Math.abs(v) < precision * 20) {
      x = target; v = 0; raf = 0;
      onUpdate?.(x);
      onRest?.(x);
      return;
    }
    onUpdate?.(x);
    raf = requestAnimationFrame(tick);
  };

  return {
    get value() { return x; },
    get velocity() { return v; },
    get target() { return target; },
    get moving() { return raf !== 0; },
    to(next, opts = {}) {
      target = next;
      if (opts.velocity != null) v = opts.velocity;
      coeff = springCoefficients(opts.response ?? response, opts.damping ?? damping);
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    },
    jump(next) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0; x = next; target = next; v = 0;
      onUpdate?.(x);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}
