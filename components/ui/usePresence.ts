import { useEffect, useState } from "react";

export const M3_EXIT_DURATION_MS = 220;

export function usePresence(open: boolean, exitDuration = M3_EXIT_DURATION_MS) {
  const [present, setPresent] = useState(open);

  useEffect(() => {
    if (open) {
      if (present) return;
      const frame = window.requestAnimationFrame(() => setPresent(true));
      return () => window.cancelAnimationFrame(frame);
    }
    if (!present) return;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setPresent(false), reducedMotion ? 0 : exitDuration);
    return () => window.clearTimeout(timer);
  }, [exitDuration, open, present]);

  return present;
}
