import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useI18n } from "../../lib/i18n";
import { networkTimeLabel } from "../../lib/network-chart";
import type { NetworkHistorySample } from "../../lib/types";
import { usePresence } from "../ui/usePresence";

export function NetworkChart({ samples, label, step = 1, seconds = false, start: requestedStart, end: requestedEnd, state }: {
  samples: NetworkHistorySample[];
  label: string;
  step?: number;
  seconds?: boolean;
  start?: number;
  end?: number;
  state?: "loading" | "error";
}) {
  const { language, t } = useI18n();
  const plotRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gradient = useId();
  const tooltipId = useId();
  const [width, setWidth] = useState(360);
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [activeAt, setActiveAt] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const present = usePresence(open, 180);
  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const resize = () => { const measured = element.getBoundingClientRect().width; if (measured > 0) setWidth(Math.round(measured)); };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!seconds) return;
    const timer = window.setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => window.clearInterval(timer);
  }, [seconds]);

  const points = samples.filter((sample) => Number.isFinite(sample.capturedAt));
  const last = points.at(-1)?.capturedAt ?? now;
  const end = requestedEnd ?? (seconds ? Math.max(last, now) : last);
  const start = requestedStart ?? (seconds ? end - 59 : points[0]?.capturedAt ?? end - step * 59);
  const visible = points.filter((sample) => sample.capturedAt >= start && sample.capturedAt <= end);
  const measured = visible.flatMap((sample) => sample.complete && typeof sample.latency === "number" && Number.isFinite(sample.latency) ? [sample.latency] : []);
  const maximum = measured.length ? Math.max(...measured) : null;
  const minimum = measured.length ? Math.min(...measured) : null;
  const plot = { left: 61, right: Math.max(73, width - 38), top: 18, bottom: 186 };
  const x = (at: number) => plot.left + (plot.right - plot.left) * Math.max(0, Math.min(1, (at - start) / Math.max(step, end - start)));
  const y = (value: number, metric: "latency" | "loss") => metric === "loss"
    ? plot.bottom - Math.max(0, Math.min(100, value)) / 100 * (plot.bottom - plot.top)
    : maximum === minimum ? (plot.top + plot.bottom) / 2
      : plot.bottom - (value - (minimum ?? 0)) / Math.max(.001, (maximum ?? 1) - (minimum ?? 0)) * (plot.bottom - plot.top);
  const segments = (metric: "latency" | "loss") => {
    const result: string[][] = [];
    let segment: string[] = [];
    let previous: number | undefined;
    for (const sample of visible) {
      const value = sample[metric];
      const usable = sample.complete && typeof value === "number" && Number.isFinite(value);
      if (!usable || sample.hasGaps || previous !== undefined && sample.capturedAt - previous > step * 1.5) {
        if (segment.length) result.push(segment);
        segment = [];
      }
      if (usable) segment.push(`${x(sample.capturedAt)},${y(value, metric)}`);
      if (sample.hasGaps && segment.length) { result.push(segment); segment = []; }
      previous = sample.capturedAt;
    }
    if (segment.length) result.push(segment);
    return result;
  };
  const selected = activeAt === null ? undefined : visible.reduce<NetworkHistorySample | undefined>((nearest, sample) =>
    !nearest || Math.abs(sample.capturedAt - activeAt) < Math.abs(nearest.capturedAt - activeAt) ? sample : nearest, undefined);
  const select = (index: number) => {
    if (!visible.length) return;
    setActiveAt(visible[Math.max(0, Math.min(visible.length - 1, index))].capturedAt);
    setOpen(true);
  };
  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix || !visible.length) return;
    const cursor = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const at = start + Math.max(0, Math.min(1, (cursor.x - plot.left) / (plot.right - plot.left))) * (end - start);
    let closest = 0;
    visible.forEach((sample, index) => { if (Math.abs(sample.capturedAt - at) < Math.abs(visible[closest].capturedAt - at)) closest = index; });
    select(closest);
  };
  const keyboard = (event: KeyboardEvent<SVGSVGElement>) => {
    const index = Math.max(0, visible.findIndex((sample) => sample.capturedAt === activeAt));
    if (event.key === "Escape") { setOpen(false); return; }
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    select(event.key === "Home" ? 0 : event.key === "End" ? visible.length - 1 : index + (event.key === "ArrowLeft" ? -1 : 1));
  };
  const tooltipX = selected ? Math.max(4, Math.min(width - 108, x(selected.capturedAt) - 50)) : 0;
  const tooltipY = selected && selected.latency !== null ? Math.max(4, Math.min(112, y(selected.latency, "latency") - 76)) : 22;
  const valid = visible.some((sample) => sample.complete && (sample.latency !== null || sample.loss !== null));
  return <div className="network-chart">
    <div className="network-chart__plot" ref={plotRef}>
      <svg ref={svgRef} viewBox={`0 0 ${width} 220`} preserveAspectRatio="xMinYMin meet" className="network-trend-chart" role="img" aria-label={label} aria-describedby={selected && open ? tooltipId : undefined} tabIndex={0}
        onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setOpen(false)} onFocus={() => select(visible.length - 1)} onBlur={() => setOpen(false)} onKeyDown={keyboard}>
        <defs><linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--primary)" stopOpacity=".14" /><stop offset="100%" stopColor="var(--primary)" stopOpacity="0" /></linearGradient></defs>
        {[plot.top, plot.bottom].map((row) => <line key={row} className="chart-grid-line" x1={plot.left} x2={plot.right} y1={row} y2={row} />)}
        <text x={plot.left - 7} y={plot.top + 4} textAnchor="end" className="chart-axis-label">{maximum === null ? "—" : maximum.toFixed(1)} ms</text>
        <text x={plot.left - 7} y={plot.bottom + 4} textAnchor="end" className="chart-axis-label">{minimum === null ? "—" : minimum.toFixed(1)} ms</text>
        <text x={plot.right + 6} y={plot.top + 4} className="chart-axis-label">100%</text>
        <text x={plot.right + 6} y={plot.bottom + 4} className="chart-axis-label">0%</text>
        {visible.filter((sample) => !sample.complete || sample.hasGaps).map((sample) => <line key={sample.capturedAt} data-gap="true" x1={x(sample.capturedAt)} x2={x(sample.capturedAt)} y1={plot.top} y2={plot.bottom} stroke="var(--error)" strokeOpacity=".25" strokeDasharray="2 4" />)}
        {(["latency", "loss"] as const).flatMap((metric) => segments(metric).map((segment, index) => <g key={`${metric}-${index}`}>
          {metric === "latency" && segment.length > 1 ? <path d={`M ${segment.join(" L ")} L ${segment.at(-1)?.split(",")[0]},${plot.bottom} L ${segment[0].split(",")[0]},${plot.bottom} Z`} fill={`url(#${gradient})`} /> : null}
          {segment.length > 1 ? <polyline data-metric={metric} points={segment.join(" ")} fill="none" stroke={metric === "latency" ? "var(--primary)" : "var(--warning)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            : <circle data-metric={metric} cx={segment[0].split(",")[0]} cy={segment[0].split(",")[1]} r="2.5" fill={metric === "latency" ? "var(--primary)" : "var(--warning)"} />}
        </g>))}
        {selected && present ? <g className={`network-chart__cursor ${open ? "is-open" : ""}`} aria-hidden="true" style={{ transform: `translateX(${x(selected.capturedAt)}px)` }}>
          <line x1="0" x2="0" y1={plot.top} y2={plot.bottom} />
          {selected.complete && selected.latency !== null ? <circle className="network-chart__point" cy={y(selected.latency, "latency")} r="4" fill="var(--primary)" /> : null}
          {selected.complete && selected.loss !== null ? <circle className="network-chart__point" cy={y(selected.loss, "loss")} r="3.5" fill="var(--warning)" /> : null}
        </g> : null}
        {[start, (start + end) / 2, end].map((at, index) => <text key={index} x={index === 0 ? plot.left : index === 2 ? plot.right : (plot.left + plot.right) / 2} y="210" textAnchor={index === 0 ? "start" : index === 2 ? "end" : "middle"} className="chart-axis-label">{networkTimeLabel(at, seconds, language)}</text>)}
        <rect className="sparkline-hit-area" x={plot.left} y={plot.top} width={plot.right - plot.left} height={plot.bottom - plot.top} />
      </svg>
      {!valid || state ? <div className="network-chart__empty" role={state === "error" ? "alert" : "status"}>{state === "loading" ? t("读取中", "Loading") : state === "error" ? t("读取失败", "Unable to load history") : "—"}</div> : null}
      {selected && present ? <div className="network-chart__tooltip-position" style={{ transform: `translate3d(${tooltipX}px, ${tooltipY}px, 0)` }}>
        <div id={tooltipId} className={`network-chart__tooltip ${open ? "is-open" : "is-leaving"}`} role="tooltip" aria-hidden={!open}>
          <div className="network-chart__tooltip-values" key={selected.capturedAt}>
          <time dateTime={new Date(selected.capturedAt * 1000).toISOString()}>{networkTimeLabel(selected.capturedAt, seconds, language)}</time>
          <b>{selected.complete && selected.latency !== null ? `${selected.latency.toFixed(1)} ms` : "— ms"}</b>
          <span>{selected.complete && selected.loss !== null ? `${Number(selected.loss.toFixed(1))}%` : "—%"}</span>
          </div>
        </div>
      </div> : null}
    </div>
    <div className="network-chart__legend"><span>{t("延迟 ms", "Latency ms")}</span><span>{t("丢包 %", "Loss %")}</span></div>
  </div>;
}
