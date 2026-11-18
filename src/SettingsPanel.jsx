import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createSpring, project, rubberband, releaseVelocity } from "./spring.js";

function useMediaQuery(query) {
  const subscribe = useCallback(cb => {
    const m = window.matchMedia(query);
    m.addEventListener("change", cb);
    return () => m.removeEventListener("change", cb);
  }, [query]);
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/**
 * The settings column. On wide screens it is a sidebar that stays beside the
 * content. On phones it is a bottom sheet raised from a floating button:
 *   - the grabber tracks the finger 1:1 from where it was grabbed
 *   - pulled past fully open it rubber-bands instead of stopping dead
 *   - on release, momentum is projected forward to decide open or closed and
 *     the spring continues at the finger's velocity
 *   - it can be grabbed again at any point of an animation
 * With reduced motion the sheet cross-fades instead of sliding.
 */
export default function SettingsPanel({ label, children }) {
  const mobile = useMediaQuery("(max-width: 820px)");
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [open, setOpen] = useState(false);       // where the sheet is heading
  const [visible, setVisible] = useState(false); // on screen, including while it animates out
  const sheet = useRef(null), scrim = useRef(null), trigger = useRef(null);
  const spring = useRef(null);
  const drag = useRef(null);
  const fadeTimer = useRef(0);
  const restingClosed = useRef(true);

  const height = () => sheet.current?.offsetHeight || 1;

  // y = 0 is fully open, y = sheet height is fully closed.
  const paint = useCallback(y => {
    if (!sheet.current) return;
    const shown = Math.min(1, Math.max(0, 1 - y / height()));
    sheet.current.style.transform = `translate3d(0, ${y}px, 0)`;
    if (scrim.current) scrim.current.style.opacity = shown;
    if (trigger.current) trigger.current.style.opacity = 1 - shown;
  }, []);

  const clearInline = useCallback(() => {
    for (const el of [sheet.current, scrim.current, trigger.current]) {
      if (el) { el.style.transform = ""; el.style.opacity = ""; }
    }
  }, []);

  if (!spring.current) {
    spring.current = createSpring({
      precision: 0.2,
      onUpdate: y => paint(y),
      onRest: () => {
        // Settled closed: hand positioning back to the stylesheet.
        if (spring.current.target > 0) { restingClosed.current = true; setVisible(false); clearInline(); }
      },
    });
  }

  const moveTo = useCallback((toOpen, velocity) => {
    const sp = spring.current;
    setOpen(toOpen);
    if (toOpen) setVisible(true);
    clearTimeout(fadeTimer.current);
    if (reduced) {
      sp.stop();
      const el = sheet.current;
      if (!el) return;
      if (toOpen) {
        el.style.transform = "none"; el.style.opacity = 0;
        void el.offsetHeight; // start the fade from transparent
        el.style.opacity = 1;
        if (scrim.current) scrim.current.style.opacity = 1;
        if (trigger.current) trigger.current.style.opacity = 0;
      } else {
        el.style.opacity = 0;
        if (scrim.current) scrim.current.style.opacity = 0;
        if (trigger.current) trigger.current.style.opacity = 1;
        fadeTimer.current = setTimeout(() => { setVisible(false); clearInline(); }, 200);
      }
      return;
    }
    // Start from where the sheet is on screen. Resting closed, that is its height.
    if (restingClosed.current) sp.jump(height());
    restingClosed.current = false;
    const thrown = velocity != null;
    sp.to(toOpen ? 0 : height(), {
      velocity,
      // Bounce only when a gesture carried momentum into the animation.
      damping: thrown ? 0.8 : 1,
      response: thrown ? 0.3 : 0.35,
    });
  }, [reduced, clearInline]);

  // Leaving the phone layout (rotation, resize): back to a plain sidebar.
  useEffect(() => {
    if (mobile) return;
    spring.current.jump(0);
    restingClosed.current = true;
    clearInline();
    setOpen(false); setVisible(false);
  }, [mobile, clearInline]);

  useEffect(() => () => { spring.current.stop(); clearTimeout(fadeTimer.current); }, []);

  // While open: lock page scroll, close on Escape, move focus in and back out.
  useEffect(() => {
    if (!mobile || !open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = e => { if (e.key === "Escape") moveTo(false); };
    window.addEventListener("keydown", onKey);
    sheet.current?.focus({ preventScroll: true });
    const from = trigger.current;
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      from?.focus({ preventScroll: true });
    };
  }, [mobile, open, moveTo]);

  const onPointerDown = e => {
    if (reduced || e.target.closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const sp = spring.current;
    sp.stop(); // grab it wherever it is, even mid-animation
    drag.current = {
      id: e.pointerId,
      // Offset between finger and sheet, so it stays glued to the grab point.
      offset: e.clientY - sp.value,
      samples: [{ t: e.timeStamp, v: e.clientY }],
      moved: false,
    };
  };
  const onPointerMove = e => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    let y = e.clientY - d.offset;
    if (y < 0) y = -rubberband(-y, height());
    if (Math.abs(e.clientY - d.samples[0].v) > 3) d.moved = true;
    d.samples.push({ t: e.timeStamp, v: e.clientY });
    if (d.samples.length > 8) d.samples.shift();
    spring.current.jump(y);
  };
  const onPointerEnd = e => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;
    const sp = spring.current;
    if (!d.moved) { moveTo(true); return; } // a tap on the grabber is not a dismissal
    const v = e.type === "pointercancel" ? 0 : releaseVelocity(d.samples, e.timeStamp);
    // Decide from where the gesture is going, not from where it was let go.
    const landing = sp.value + project(v);
    moveTo(landing < height() / 2, v);
  };

  if (!mobile) {
    return <aside className="gt-sidebar"><div className="gt-sidebar-body">{children}</div></aside>;
  }

  return (
    <>
      <button ref={trigger} type="button" className="gt-sheet-trigger" onClick={() => moveTo(true)}
        aria-haspopup="dialog" aria-expanded={open} tabIndex={open ? -1 : 0}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
          <path d="M2 4.5h7M12.5 4.5H14M2 11.5h1.5M7 11.5h7" /><circle cx="10.75" cy="4.5" r="1.75" /><circle cx="5.25" cy="11.5" r="1.75" />
        </svg>
        {label}
      </button>
      <div ref={scrim} className="gt-scrim" data-open={open} onClick={() => moveTo(false)} />
      <aside ref={sheet} className="gt-sidebar gt-sheet" data-visible={visible} role="dialog" aria-modal="true"
        aria-label={label} tabIndex={-1}>
        <div className="gt-sheet-handle" onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd} onPointerCancel={onPointerEnd}>
          <div className="gt-grabber" aria-hidden="true" />
          <div className="gt-sheet-title">{label}</div>
          <button type="button" className="gt-sheet-done" onClick={() => moveTo(false)}>Done</button>
        </div>
        <div className="gt-sidebar-body">{children}</div>
      </aside>
    </>
  );
}
