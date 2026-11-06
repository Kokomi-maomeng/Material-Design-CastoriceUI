import { useEffect, useRef } from "react";

const REST = { x: 18, y: 0 };

/** A short, interruptible follow/return motion; idle and touch screens stay still. */
export function useGlassLight(enabled: boolean) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const card = ref.current;
    if (!card || !enabled) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce), (prefers-reduced-transparency: reduce), (prefers-contrast: more)");
    let current = { ...REST }, target = { ...REST }, frame = 0, previous = 0;
    const paint = () => {
      card.style.setProperty("--glass-light-x", `${current.x}%`);
      card.style.setProperty("--glass-light-y", `${current.y}%`);
    };
    const tick = (now: number) => {
      frame = 0;
      const amount = 1 - Math.exp(-Math.min(64, Math.max(0, now - previous)) / 85);
      previous = now;
      current.x += (target.x - current.x) * amount;
      current.y += (target.y - current.y) * amount;
      const settled = Math.abs(target.x - current.x) < .02 && Math.abs(target.y - current.y) < .02;
      if (settled) current = { ...target };
      paint();
      if (!settled) frame = requestAnimationFrame(tick);
    };
    const follow = (next: typeof REST) => {
      target = next;
      if (!frame) { previous = performance.now(); frame = requestAnimationFrame(tick); }
    };
    const rest = () => follow({ ...REST });
    const reset = () => {
      cancelAnimationFrame(frame); frame = 0;
      current = { ...REST }; target = { ...REST }; paint();
    };
    const move = (event: PointerEvent) => {
      if (reduced.matches || document.hidden) return;
      // The current input is authoritative on hybrid devices and browsers
      // whose device-wide hover query does not describe an attached mouse.
      if (event.pointerType === "touch") { rest(); return; }
      if (event.pointerType !== "mouse" && !(event.pointerType === "pen" && event.buttons === 0)) return;
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const clamp = (value: number) => Math.max(0, Math.min(100, value));
      follow({ x: clamp((event.clientX - rect.left) / rect.width * 100), y: clamp((event.clientY - rect.top) / rect.height * 100) });
    };
    const visibility = () => { if (document.hidden) reset(); };
    card.addEventListener("pointerenter", move);
    card.addEventListener("pointermove", move);
    card.addEventListener("pointerleave", rest);
    card.addEventListener("pointercancel", rest);
    window.addEventListener("blur", rest);
    window.addEventListener("resize", rest);
    document.addEventListener("visibilitychange", visibility);
    reduced.addEventListener("change", reset);
    return () => {
      cancelAnimationFrame(frame);
      card.removeEventListener("pointerenter", move);
      card.removeEventListener("pointermove", move);
      card.removeEventListener("pointerleave", rest);
      card.removeEventListener("pointercancel", rest);
      window.removeEventListener("blur", rest);
      window.removeEventListener("resize", rest);
      document.removeEventListener("visibilitychange", visibility);
      reduced.removeEventListener("change", reset);
      card.style.removeProperty("--glass-light-x");
      card.style.removeProperty("--glass-light-y");
    };
  }, [enabled]);
  return ref;
}
