import { useEffect, useLayoutEffect, useRef } from "react";
import { createSpring } from "./spring.js";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Segmented control. Segments are equal width, so the selection thumb only
 * ever translates: a critically damped spring carries it from wherever it is
 * on screen to the new segment, and a second press mid-flight just re-targets.
 *
 * props: options [{ value, label }], value, onChange(value), ariaLabel,
 *        size "md" | "sm", stretch (fill the container width)
 */
export default function Segmented({ options, value, onChange, ariaLabel, size = "md", stretch = false }) {
  const thumb = useRef(null);
  const spring = useRef(null);
  const index = Math.max(0, options.findIndex(o => o.value === value));

  useLayoutEffect(() => {
    const paint = x => { if (thumb.current) thumb.current.style.transform = `translateX(${x * 100}%)`; };
    if (!spring.current) {
      spring.current = createSpring({ value: index, response: 0.3, damping: 1, precision: 0.001, onUpdate: paint });
      paint(index);
    } else if (reducedMotion()) {
      spring.current.jump(index);
    } else {
      spring.current.to(index);
    }
  }, [index]);
  useEffect(() => () => spring.current?.stop(), []);

  return (
    <div className={`gt-seg gt-seg-${size}${stretch ? " gt-seg-stretch" : ""}`} role="group" aria-label={ariaLabel}
      style={{ "--n": options.length }}>
      <div ref={thumb} className="gt-seg-thumb" aria-hidden="true" />
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
