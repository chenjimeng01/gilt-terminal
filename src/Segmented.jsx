import { useEffect, useLayoutEffect, useRef } from "react";
import { createSpring } from "./spring.js";

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Segmented control. Each segment is as wide as its label needs (spare room
 * is shared out), and the selection thumb is measured from the pressed
 * segment: critically damped springs carry its position and width from
 * wherever they are on screen, and a second press mid-flight just re-targets.
 *
 * props: options [{ value, label }], value, onChange(value), ariaLabel,
 *        size "md" | "sm", stretch (fill the container width)
 */
export default function Segmented({ options, value, onChange, ariaLabel, size = "md", stretch = false }) {
  const root = useRef(null);
  const thumb = useRef(null);
  const springs = useRef(null);

  const place = animate => {
    const btn = root.current?.querySelector('button[aria-pressed="true"]');
    if (!btn || !thumb.current || !springs.current) return;
    const { x, w } = springs.current;
    if (animate && !reducedMotion()) { x.to(btn.offsetLeft); w.to(btn.offsetWidth); }
    else { x.jump(btn.offsetLeft); w.jump(btn.offsetWidth); }
  };

  useLayoutEffect(() => {
    const first = !springs.current;
    if (first) {
      const opts = { response: 0.3, damping: 1, precision: 0.05 };
      springs.current = {
        x: createSpring({ ...opts, onUpdate: v => { if (thumb.current) thumb.current.style.transform = `translateX(${v}px)`; } }),
        w: createSpring({ ...opts, onUpdate: v => { if (thumb.current) thumb.current.style.width = `${v}px`; } }),
      };
    }
    place(!first);
  }, [value]);

  // Keep the thumb on its segment when the control is resized or fonts load.
  useEffect(() => {
    const ro = new ResizeObserver(() => place(false));
    ro.observe(root.current);
    return () => { ro.disconnect(); springs.current?.x.stop(); springs.current?.w.stop(); };
  }, []);

  return (
    <div ref={root} className={`gt-seg gt-seg-${size}${stretch ? " gt-seg-stretch" : ""}`} role="group" aria-label={ariaLabel}>
      <div ref={thumb} className="gt-seg-thumb" aria-hidden="true" />
      {options.map(o => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
