import { useEffect, useRef } from "react";
import { usePresence } from "../ui/usePresence";

export function ChartTooltip({ id, open, onOpenChange, x, y, width, height, time, dateTime, readings }: {
  id: string; open: boolean; x: number; y: number; width: number; height: number;
  onOpenChange: (open: boolean) => void;
  time: string; dateTime?: string; readings: { label: string; value: string; color: string }[];
}) {
  const present = usePresence(open, 180);
  const position = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.pointerType === "touch" && event.target instanceof Node && !position.current?.parentElement?.contains(event.target)) onOpenChange(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [open, onOpenChange]);
  if (!open && !present) return null;
  const tooltipWidth = Math.min(182, Math.max(1, width - 8));
  const left = Math.max(4, Math.min(width - tooltipWidth - 4, x - tooltipWidth / 2));
  const top = Math.max(4, Math.min(height - 78, y - 82));
  return <div ref={position} className="chart-tooltip-position" style={{ width: tooltipWidth, transform: `translate3d(${left}px, ${top}px, 0)` }}>
    <div className={`chart-tooltip ${open ? "is-open" : "is-leaving"}`} role="tooltip" id={id} aria-hidden={!open}>
      <time dateTime={dateTime}>{time}</time>
      {readings.map(({ label, value, color }) => <div className="chart-tooltip__reading" key={label}>
        <span className="dot" style={{ background: color }} /><span>{label}</span><span>{value}</span>
      </div>)}
    </div>
  </div>;
}
