"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useI18n } from "../../lib/i18n";
import type { ResourceSample } from "../../lib/types";

const WIDTH = 720;
const HEIGHT = 260;
const PLOT = { x: 44, y: 16, width: 656, height: 198 };

export function ResourceChart({ data }: { data: ResourceSample[] }) {
  const { language, t } = useI18n();
  const gradientId = useId().replaceAll(":", "");
  const [selection, setSelection] = useState<number | null>(null);
  const active = selection === null || !data.length ? -1 : Math.min(data.length - 1, Math.round(selection * (data.length - 1)));
  const x = (index: number) => PLOT.x + index / Math.max(1, data.length - 1) * PLOT.width;
  const y = (value: number) => PLOT.y + PLOT.height * (1 - Math.max(0, Math.min(100, value)) / 100);
  const path = (field: "cpuPercent" | "memoryPercent") => data.map((sample, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(sample[field]).toFixed(1)}`).join(" ");
  const label = (sample: ResourceSample) => new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(sample.capturedAt));
  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    setSelection(Math.max(0, Math.min(1, (point.x - PLOT.x) / PLOT.width)));
  };
  const moveSelection = (event: KeyboardEvent<SVGSVGElement>) => {
    let next = active < 0 ? data.length - 1 : active;
    if (event.key === "ArrowLeft") next = Math.max(0, next - 1);
    else if (event.key === "ArrowRight") next = Math.min(data.length - 1, next + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = data.length - 1;
    else return;
    event.preventDefault();
    setSelection(next / Math.max(1, data.length - 1));
  };
  if (!data.length) return <div className="chart-empty" role="status">{t("正在建立 CPU 与内存采样记录", "CPU and memory samples are being collected")}</div>;
  const selected = active >= 0 ? data[active] : null;
  const tooltipX = selected ? Math.max(50, Math.min(WIDTH - 178, x(active) - 85)) : 0;
  return <div className="resource-chart" role="region" aria-label={t("CPU 与内存历史记录", "CPU and memory history")}>
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" tabIndex={0} aria-label={t("CPU 与内存使用率，可移动鼠标或使用方向键查看采样", "CPU and memory usage; use the pointer or arrow keys to inspect samples")} onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setSelection(null)} onFocus={() => setSelection((value) => value ?? 1)} onBlur={() => setSelection(null)} onKeyDown={moveSelection}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-primary)" stopOpacity=".2" /><stop offset="100%" stopColor="var(--chart-primary)" stopOpacity="0" /></linearGradient></defs>
      {[0, 25, 50, 75, 100].map((value) => <g key={value}><line className="chart-grid-line" x1={PLOT.x} x2={PLOT.x + PLOT.width} y1={y(value)} y2={y(value)} /><text className="chart-axis-label" x={PLOT.x - 9} y={y(value) + 4} textAnchor="end">{value}%</text></g>)}
      {data.length > 1 ? <path d={`${path("cpuPercent")} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={`url(#${gradientId})`} /> : null}
      <path className="chart-line chart-line--primary" d={path("cpuPercent")} />
      <path className="chart-line chart-line--secondary" d={path("memoryPercent")} />
      {data.filter((_, index) => index === 0 || index === data.length - 1 || index % Math.max(1, Math.ceil(data.length / 5)) === 0).map((sample) => { const index = data.indexOf(sample); return <text key={sample.capturedAt} className="chart-axis-label" x={x(index)} y={HEIGHT - 8} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}>{label(sample)}</text>; })}
      {selected ? <g className="chart-inspector" pointerEvents="none"><line x1={x(active)} x2={x(active)} y1={PLOT.y} y2={PLOT.y + PLOT.height} /><rect x={tooltipX} y="22" width="172" height="66" rx="16" /><text x={tooltipX + 12} y="40" className="chart-tooltip-title">{label(selected)}</text><circle cx={tooltipX + 14} cy="56" r="4" className="chart-tooltip-dot chart-tooltip-dot--primary" /><text x={tooltipX + 24} y="60">CPU {selected.cpuPercent.toFixed(1)}%</text><circle cx={tooltipX + 14} cy="74" r="4" className="chart-tooltip-dot chart-tooltip-dot--secondary" /><text x={tooltipX + 24} y="78">{t("内存", "Memory")} {selected.memoryPercent.toFixed(1)}%</text></g> : null}
      <rect className="chart-hit-area" x={PLOT.x} y={PLOT.y} width={PLOT.width} height={PLOT.height} />
    </svg>
  </div>;
}
