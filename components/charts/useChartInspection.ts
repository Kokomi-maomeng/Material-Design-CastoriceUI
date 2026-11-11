import { useState, type KeyboardEvent, type PointerEvent } from "react";
import type { chartTime } from "../../lib/chart-time";

export function useChartInspection(data: { capturedAt?: string; label?: string }[], timeline: ReturnType<typeof chartTime>, plot: { x: number; width: number }) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const occurrences = new Map<string, number>();
  const keys = data.map((item) => {
    const identity = item.capturedAt || item.label || "";
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    return `${identity}\u0000${occurrence}`;
  });
  const active = hoverRatio !== null && data.length
    ? timeline.nearest(hoverRatio)
    : activeKey === null ? -1 : keys.indexOf(activeKey);

  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const cursor = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const ratio = Math.max(0, Math.min(1, (cursor.x - plot.x) / plot.width));
    setHoverRatio(ratio);
    setActiveKey(keys[timeline.nearest(ratio)] ?? null);
    setOpen(true);
  };
  const moveSelection = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    let next = active >= 0 ? active : data.length - 1;
    if (event.key === "ArrowLeft") next = Math.max(0, next - 1);
    else if (event.key === "ArrowRight") next = Math.min(data.length - 1, next + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = data.length - 1;
    else return;
    event.preventDefault();
    setHoverRatio(null);
    setActiveKey(keys[next] ?? null);
    setOpen(true);
  };

  return { active, open, setOpen, events: {
    onPointerMove: pick,
    onPointerDown: pick,
    onPointerLeave: (event: PointerEvent<SVGSVGElement>) => { if (event.pointerType !== "touch") setOpen(false); },
    onPointerCancel: () => setOpen(false),
    onFocus: () => {
      setActiveKey((value) => value && keys.includes(value) ? value : keys.at(-1) ?? null);
      setOpen(true);
    },
    onBlur: () => setOpen(false),
    onKeyDown: moveSelection,
  } };
}
