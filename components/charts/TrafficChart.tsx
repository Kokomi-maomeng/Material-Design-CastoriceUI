"use client";

import { Component, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../../lib/i18n";
import type { TrafficPoint } from "../../lib/types";
import { chartTime } from "../../lib/chart-time";
import { smoothChartPath } from "../../lib/chart-path";
import { ChartTooltip } from "./ChartTooltip";
import { useChartInspection } from "./useChartInspection";

const INITIAL_SIZE = { width: 680, height: 270 };
interface Point { x: number; y: number }

interface TrafficChartBoundaryState { failed: boolean }

class TrafficChartBoundary extends Component<{ children: ReactNode; fallback: ReactNode; resetSignature: string }, TrafficChartBoundaryState> {
  state: TrafficChartBoundaryState = { failed: false };

  static getDerivedStateFromError(): TrafficChartBoundaryState {
    return { failed: true };
  }

  componentDidUpdate(previous: Readonly<{ resetSignature: string }>) {
    if (this.state.failed && previous.resetSignature !== this.props.resetSignature) this.setState({ failed: false });
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function TrafficChart({ data }: { data: TrafficPoint[] }) {
  const { t } = useI18n();
  const last = data[data.length - 1];
  const resetSignature = `${data.length}:${data[0]?.capturedAt ?? data[0]?.label ?? "empty"}:${last?.capturedAt ?? last?.label ?? "empty"}`;
  return <TrafficChartBoundary resetSignature={resetSignature} fallback={<div className="chart-empty" role="alert">{t("流量图暂时无法显示；其他页面仍可使用", "The traffic chart is temporarily unavailable; other pages remain usable")}</div>}>
    <TrafficChartPlot data={data} />
  </TrafficChartBoundary>;
}

function TrafficChartPlot({ data }: { data: TrafficPoint[] }) {
  const { language, t } = useI18n();
  const [viewSize, setViewSize] = useState(INITIAL_SIZE);
  const plotRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();
  const downloadGradient = useId();
  const uploadGradient = useId();
  const hasData = data.length > 0;
  const timeline = chartTime(data);
  const { width: viewWidth, height: viewHeight } = viewSize;
  const plot = { x: 56, y: 16, width: Math.max(1, viewWidth - 72), height: Math.max(1, viewHeight - 52) };
  const { active, open, setOpen, events } = useChartInspection(data, timeline, plot);
  useEffect(() => {
    const viewport = plotRef.current;
    if (!viewport) return;
    const update = () => {
      const rect = viewport.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setViewSize((current) => current.width === next.width && current.height === next.height ? current : next);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    // Measure a CSS-sized viewport. The SVG must never determine that size.
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [hasData]);
  if (!data.length) return <div className="chart-empty" role="status">{t("该时间范围正在建立真实采样数据", "Real samples are still being collected for this range")}</div>;
  const rawMax = data.reduce((current, item) => Math.max(current, item.download, item.upload), 1);
  const max = Math.ceil(rawMax / 10) * 10;
  const point = (value: number, index: number): Point => ({ x: plot.x + timeline.ratios[index] * plot.width, y: plot.y + plot.height - (value / max) * plot.height });
  const downloadPoints = data.map((item, index) => point(item.download, index)); const uploadPoints = data.map((item, index) => point(item.upload, index));
  const path = (items: Point[], group: number[]) => smoothChartPath(group.map((index) => [items[index].x, items[index].y]));
  const line = (items: Point[]) => timeline.groups.map((group) => path(items, group)).join(" ");
  const area = (items: Point[]) => timeline.groups.filter((group) => group.length > 1).map((group) => `${path(items, group)} L ${items[group[group.length - 1]].x},${plot.y + plot.height} L ${items[group[0]].x},${plot.y + plot.height} Z`).join(" ");
  const selected = active >= 0 ? data[active] : null;
  const selectedX = active >= 0 ? downloadPoints[active]?.x ?? 0 : 0;
  const selectedY = selected ? Math.min(downloadPoints[active].y, uploadPoints[active].y) : 0;
  const timestamps = data.map((item) => item.capturedAt ? Date.parse(item.capturedAt) : Number.NaN).filter(Number.isFinite);
  const longRange = timestamps.length > 1 && timestamps[timestamps.length - 1] - timestamps[0] > 36 * 60 * 60 * 1000;
  const displayLabel = (item: TrafficPoint) => {
    if (!item.capturedAt || Number.isNaN(Date.parse(item.capturedAt))) return item.label;
    return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", longRange
      ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      : { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(item.capturedAt));
  };
  const labelStep = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(plot.width / 95))));
  const showAxisLabel = (index: number) => index === 0 || index === data.length - 1 || (index % labelStep === 0 && data.length - 1 - index >= labelStep * .75);

  return <div className="chart chart--traffic" role="region" aria-label={t("上传与下载流量趋势", "Upload and download traffic trend")}><div ref={plotRef} className="traffic-chart-plot"><svg className="native-chart native-chart--interactive" viewBox={`0 0 ${viewWidth} ${viewHeight}`} preserveAspectRatio="xMinYMin meet" role="img" tabIndex={0}
    aria-label={t("上传与下载流量趋势图，可移动鼠标或使用方向键查看数值", "Upload and download traffic trend. Use the pointer or arrow keys to inspect values")}
    aria-describedby={selected && open ? tooltipId : undefined} {...events}>
    <defs><linearGradient id={downloadGradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-primary)" stopOpacity=".32" /><stop offset="100%" stopColor="var(--chart-primary)" stopOpacity=".02" /></linearGradient><linearGradient id={uploadGradient} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-secondary)" stopOpacity=".22" /><stop offset="100%" stopColor="var(--chart-secondary)" stopOpacity=".01" /></linearGradient></defs>
    {[0, .25, .5, .75, 1].map((ratio) => { const y = plot.y + plot.height - ratio * plot.height; return <g key={ratio}><line className="chart-grid-line" x1={plot.x} x2={plot.x + plot.width} y1={y} y2={y} /><text className="chart-axis-label" x={plot.x - 8} y={y + 4} textAnchor="end">{Math.round(max * ratio)} GB</text></g>; })}
    {data.map((item, index) => showAxisLabel(index) ? <text className="chart-axis-label" key={`${item.label}-${index}`} x={point(0, index).x} y={viewHeight - 8} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}>{displayLabel(item)}</text> : null)}
    <path d={area(downloadPoints)} fill={`url(#${downloadGradient})`} /><path d={area(uploadPoints)} fill={`url(#${uploadGradient})`} /><path className="chart-line chart-line--primary" d={line(downloadPoints)} /><path className="chart-line chart-line--secondary" d={line(uploadPoints)} />
    {data.map((item, index) => <g key={`${item.label}-${index}`}><circle className="chart-point chart-point--primary" cx={downloadPoints[index].x} cy={downloadPoints[index].y} r="3" /><circle className="chart-point chart-point--secondary" cx={uploadPoints[index].x} cy={uploadPoints[index].y} r="3" /></g>)}
    {selected ? <g className={`chart-inspector ${open ? "is-open" : ""}`} pointerEvents="none" style={{ transform: `translateX(${selectedX}px)` }}>
      <line y1={plot.y} y2={plot.y + plot.height} />
      <circle className="chart-inspector__point" cy={downloadPoints[active].y} r="4" fill="var(--chart-primary)" />
      <circle className="chart-inspector__point" cy={uploadPoints[active].y} r="4" fill="var(--chart-secondary)" />
    </g> : null}
    <rect className="chart-hit-area" x={plot.x} y={plot.y} width={plot.width} height={plot.height} />
  </svg>
  {selected ? <ChartTooltip id={tooltipId} open={open} onOpenChange={setOpen} x={selectedX} y={selectedY} width={viewWidth} height={plot.y + plot.height} time={displayLabel(selected)} dateTime={selected.capturedAt}
    readings={[
      { label: t("下载", "Download"), value: `${selected.download.toFixed(2)} GB`, color: "var(--chart-primary)" },
      { label: t("上传", "Upload"), value: `${selected.upload.toFixed(2)} GB`, color: "var(--chart-secondary)" },
    ]} /> : null}
  </div><small>{t("每点为该区间的流量总量，曲线断开处为缺测。", "Each point is an interval total. Breaks indicate missing samples.")}</small></div>;
}
