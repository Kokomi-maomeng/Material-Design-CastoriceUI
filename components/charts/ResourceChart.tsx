"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n";
import type { ResourceSample } from "../../lib/types";
import { chartTime } from "../../lib/chart-time";
import { ChartTooltip } from "./ChartTooltip";
import { useChartInspection } from "./useChartInspection";

export function ResourceChart({ data }: { data: ResourceSample[] }) {
  const { language, t } = useI18n();
  const gradientId = useId().replaceAll(":", "");
  const tooltipId = useId();
  const [size, setSize] = useState({ width: 720, height: 240 });
  const plotRef = useRef<HTMLDivElement>(null);
  const hasData = data.length > 0;
  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const resize = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setSize((previous) => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasData]);
  const { width, height } = size;
  const plot = { x: 44, y: 16, width: Math.max(1, width - 64), height: Math.max(1, height - 44) };
  const timeline = chartTime(data);
  const { active, open, setOpen, events } = useChartInspection(data, timeline, plot);
  if (!data.length) return <div className="chart-empty" role="status">{t("正在建立 CPU 与内存采样记录", "CPU and memory samples are being collected")}</div>;
  const x = (index: number) => plot.x + timeline.ratios[index] * plot.width;
  const y = (value: number) => plot.y + plot.height * (1 - Math.max(0, Math.min(100, value)) / 100);
  const path = (field: "cpuPercent" | "memoryPercent", group: number[]) => group.map((index, offset) => `${offset ? "L" : "M"}${x(index).toFixed(1)},${y(data[index][field]).toFixed(1)}`).join(" ");
  const selected = active >= 0 ? data[active] : null;
  const timeOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" } as const;
  const locale = language === "zh" ? "zh-CN" : "en";
  const axisTime = new Intl.DateTimeFormat(locale, timeOptions);
  const sampleTime = new Intl.DateTimeFormat(locale, { ...timeOptions, month: "2-digit", day: "2-digit" });
  const labelStep = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plot.width / 80))));
  return <div className="resource-chart" role="region" aria-label={t("CPU 与内存历史记录", "CPU and memory history")}><div ref={plotRef} className="resource-chart-plot">
    <svg className="native-chart native-chart--interactive" viewBox={`0 0 ${width} ${height}`} role="img" tabIndex={0} aria-label={t("CPU 与内存使用率，可移动鼠标或使用方向键查看采样", "CPU and memory usage. Use the pointer or arrow keys to inspect samples")} aria-describedby={selected && open ? tooltipId : undefined} {...events}>
      <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-primary)" stopOpacity=".2" /><stop offset="100%" stopColor="var(--chart-primary)" stopOpacity="0" /></linearGradient></defs>
      {[0, 25, 50, 75, 100].map((value) => <g key={value}><line className="chart-grid-line" x1={plot.x} x2={plot.x + plot.width} y1={y(value)} y2={y(value)} /><text className="chart-axis-label" x={plot.x - 9} y={y(value) + 4} textAnchor="end">{value}%</text></g>)}
      {timeline.groups.filter((group) => group.length > 1).map((group) => <path key={group[0]} d={`${path("cpuPercent", group)} L${x(group[group.length - 1])},${y(0)} L${x(group[0])},${y(0)} Z`} fill={`url(#${gradientId})`} />)}
      <path className="chart-line chart-line--primary" d={timeline.groups.map((group) => path("cpuPercent", group)).join(" ")} />
      <path className="chart-line chart-line--secondary" d={timeline.groups.map((group) => path("memoryPercent", group)).join(" ")} />
      {timeline.groups.filter((group) => group.length === 1).map(([index]) => <g key={index}><circle className="chart-point chart-point--isolated chart-point--primary" cx={x(index)} cy={y(data[index].cpuPercent)} r="3" /><circle className="chart-point chart-point--isolated chart-point--secondary" cx={x(index)} cy={y(data[index].memoryPercent)} r="3" /></g>)}
      {data.map((sample, index) => index === 0 || index === data.length - 1 || index % labelStep === 0 && data.length - 1 - index >= labelStep * .75
        ? <text key={`${sample.capturedAt}-${index}`} className="chart-axis-label" x={x(index)} y={height - 8} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}>{axisTime.format(new Date(sample.capturedAt))}</text> : null)}
      {selected ? <g className={`chart-inspector ${open ? "is-open" : ""}`} pointerEvents="none" style={{ transform: `translateX(${x(active)}px)` }}>
        <line y1={plot.y} y2={y(0)} />
        <circle className="chart-inspector__point" cy={y(selected.cpuPercent)} r="4" fill="var(--chart-primary)" />
        <circle className="chart-inspector__point" cy={y(selected.memoryPercent)} r="4" fill="var(--chart-secondary)" />
      </g> : null}
      <rect className="chart-hit-area" x={plot.x} y={plot.y} width={plot.width} height={plot.height} />
    </svg>
    {selected ? <ChartTooltip id={tooltipId} open={open} onOpenChange={setOpen} x={x(active)} y={Math.min(y(selected.cpuPercent), y(selected.memoryPercent))} width={width} height={y(0)} time={sampleTime.format(new Date(selected.capturedAt))} dateTime={selected.capturedAt}
      readings={[
        { label: "CPU", value: `${selected.cpuPercent.toFixed(1)}%`, color: "var(--chart-primary)" },
        { label: t("内存", "Memory"), value: `${selected.memoryPercent.toFixed(1)}%`, color: "var(--chart-secondary)" },
      ]} /> : null}
  </div></div>;
}
