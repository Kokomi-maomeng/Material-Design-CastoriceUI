import { useState, type CSSProperties } from "react";

// Native range input retains pointer capture, touch and assistive technology
// support. Its decorative thumb follows continuous input and eases into a stop.
export function PresetSlider({ value, labels, ariaLabel, onChange }: {
  value: number;
  labels: string[];
  ariaLabel: string;
  onChange: (value: number) => void;
}) {
  const [dragPosition, setDragPosition] = useState<number | null>(null);
  const position = dragPosition ?? value;
  const dragging = dragPosition !== null;
  const maximum = labels.length - 1;
  const update = (next: number) => {
    const bounded = Math.max(0, Math.min(maximum, next));
    if (dragging) setDragPosition(bounded);
    onChange(Math.round(bounded));
  };
  const settle = () => {
    setDragPosition(null);
    onChange(Math.round(position));
  };
  return <div className={`md-preset-slider ${dragging ? "is-dragging" : ""}`} style={{ "--slider-fraction": position / maximum } as CSSProperties}>
    <div className="md-preset-slider__control">
      <span className="md-preset-slider__track" aria-hidden="true"><i /></span>
      <span className="md-preset-slider__thumb" aria-hidden="true" />
      <input type="range" min="0" max={maximum} step="0.01" value={position}
        aria-label={ariaLabel} aria-valuenow={value} aria-valuetext={labels[value]}
        onPointerDown={() => setDragPosition(value)} onPointerUp={settle} onPointerCancel={settle} onBlur={settle}
        onChange={(event) => update(Number(event.target.value))}
        onKeyDown={(event) => {
          const offset = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 1, PageDown: -1 }[event.key];
          if (offset === undefined && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          update(event.key === "Home" ? 0 : event.key === "End" ? maximum : value + (offset ?? 0));
        }} />
    </div>
    <div className="md-preset-slider__labels" aria-hidden="true">{labels.map((label, index) => <span className={index === value ? "is-selected" : ""} key={label}>{label}</span>)}</div>
  </div>;
}
