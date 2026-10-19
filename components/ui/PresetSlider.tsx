import { useEffect, useRef, useState, type CSSProperties } from "react";

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
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const maximum = labels.length - 1;
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    // WebKit takes over native range dragging and can cancel the pointer
    // stream. Native change still identifies its real commit, even when
    // React deduplicates it after the preceding input events.
    const finish = () => {
      setDragging(false);
      setDragPosition(null);
      onChange(Math.round(element.valueAsNumber));
    };
    element.addEventListener("change", finish);
    return () => element.removeEventListener("change", finish);
  }, [onChange]);
  const update = (next: number) => {
    const bounded = Math.max(0, Math.min(maximum, next));
    setDragPosition(bounded);
    setDragging(true);
    onChange(Math.round(bounded));
  };
  const settle = (next: number) => {
    setDragging(false);
    setDragPosition(null);
    onChange(Math.round(Math.max(0, Math.min(maximum, next))));
  };
  return <div className={`md-preset-slider ${dragging ? "is-dragging" : ""}`} style={{ "--slider-fraction": position / maximum } as CSSProperties}>
    <div className="md-preset-slider__control">
      <span className="md-preset-slider__track" aria-hidden="true"><i /></span>
      <span className="md-preset-slider__thumb" aria-hidden="true" />
      <input ref={input} type="range" min="0" max={maximum} step="0.01" value={position}
        aria-label={ariaLabel} aria-valuenow={value} aria-valuetext={labels[value]}
        onPointerDown={() => { setDragging(true); setDragPosition(value); }}
        onPointerUp={(event) => settle(event.currentTarget.valueAsNumber)}
        onPointerCancel={() => setDragging(false)} onBlur={(event) => settle(event.currentTarget.valueAsNumber)}
        onChange={(event) => { if (event.nativeEvent.type === "input") update(Number(event.target.value)); }}
        onKeyDown={(event) => {
          const offset = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 1, PageDown: -1 }[event.key];
          if (offset === undefined && event.key !== "Home" && event.key !== "End") return;
          event.preventDefault();
          settle(event.key === "Home" ? 0 : event.key === "End" ? maximum : value + (offset ?? 0));
        }} />
    </div>
    <div className="md-preset-slider__labels" aria-hidden="true">{labels.map((label, index) => <span className={index === value ? "is-selected" : ""} key={label}>{label}</span>)}</div>
  </div>;
}
