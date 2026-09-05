"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { useI18n } from "../../lib/i18n";
import type { TrafficPoint } from "../../lib/types";

const BASE_WIDTH = 680; const MIN_VIEW_WIDTH = 320; const HEIGHT = 270;
interface Point { x: number; y: number }
function smoothPath(points: Point[]): string { if (!points.length) return ""; if (points.length === 1) return `M ${points[0].x},${points[0].y}`; return points.slice(1).reduce((path, current, index) => { const previous = points[index]; const mid = (previous.x + current.x) / 2; return `${path} C ${mid},${previous.y} ${mid},${current.y} ${current.x},${current.y}`; }, `M ${points[0].x},${points[0].y}`); }

export function TrafficChart({ data }: { data: TrafficPoint[] }) {
  const { language, t } = useI18n();
  const [active, setActive] = useState<number | null>(null);
  const [viewWidth, setViewWidth] = useState(BASE_WIDTH);
  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const update = () => {
      const rect = svg.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const next = Math.max(MIN_VIEW_WIDTH, Math.min(1480, Math.round((rect.width / rect.height) * HEIGHT)));
      setViewWidth((current) => Math.abs(current - next) > 1 ? next : current);
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(svg);
    return () => observer.disconnect();
  }, [data.length]);
  if (!data.length) return <div className="chart-empty" role="status">{t("该时间范围正在建立真实采样数据", "Real samples are still being collected for this range")}</div>;
  const plot = { x: 48, y: 16, width: viewWidth - 68, height: 210 };
  const rawMax = data.reduce((current, item) => Math.max(current, item.download, item.upload), 1);
  const max = Math.ceil(rawMax / 10) * 10;
  const point = (value: number, index: number): Point => ({ x: plot.x + (index / Math.max(1, data.length - 1)) * plot.width, y: plot.y + plot.height - (value / max) * plot.height });
  const downloadPoints = data.map((item, index) => point(item.download, index)); const uploadPoints = data.map((item, index) => point(item.upload, index));
  const area = (items: Point[]) => `${smoothPath(items)} L ${plot.x + plot.width},${plot.y + plot.height} L ${plot.x},${plot.y + plot.height} Z`;
  const pick = (event: PointerEvent<SVGSVGElement>) => {
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const cursor = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const ratio = (cursor.x - plot.x) / plot.width;
    setActive(Math.max(0, Math.min(data.length - 1, Math.round(ratio * (data.length - 1)))));
  };
  const selected = active === null ? null : data[active]; const selectedX = active === null ? 0 : downloadPoints[active].x; const tooltipX = Math.min(viewWidth - 170, Math.max(54, selectedX - 74));
  const timestamps = data.map((item) => item.capturedAt ? Date.parse(item.capturedAt) : Number.NaN).filter(Number.isFinite);
  const longRange = timestamps.length > 1 && timestamps[timestamps.length - 1] - timestamps[0] > 36 * 60 * 60 * 1000;
  const displayLabel = (item: TrafficPoint) => {
    if (!item.capturedAt || Number.isNaN(Date.parse(item.capturedAt))) return item.label;
    return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", longRange
      ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }
      : { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(item.capturedAt));
  };
  const labelStep = Math.max(1, Math.ceil(data.length / 7));
  const showAxisLabel = (index: number) => index === 0 || index === data.length - 1 || index % labelStep === 0;

  return <div className="chart chart--traffic" role="region" aria-label={t("上传与下载流量趋势", "Upload and download traffic trend")}><svg ref={svgRef} className="native-chart native-chart--interactive" viewBox={`0 0 ${viewWidth} ${HEIGHT}`} preserveAspectRatio="xMinYMin meet" role="img" tabIndex={0} aria-label={t("上传与下载流量趋势图，可移动鼠标查看数值", "Upload and download traffic trend; move the pointer to inspect values")} onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setActive(null)} onFocus={() => setActive((value) => value ?? data.length - 1)} onBlur={() => setActive(null)}>
    <defs><linearGradient id="nativeDownloadGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-primary)" stopOpacity=".32" /><stop offset="100%" stopColor="var(--chart-primary)" stopOpacity=".02" /></linearGradient><linearGradient id="nativeUploadGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-secondary)" stopOpacity=".22" /><stop offset="100%" stopColor="var(--chart-secondary)" stopOpacity=".01" /></linearGradient></defs>
    {[0, .25, .5, .75, 1].map((ratio) => { const y = plot.y + plot.height - ratio * plot.height; return <g key={ratio}><line className="chart-grid-line" x1={plot.x} x2={plot.x + plot.width} y1={y} y2={y} /><text className="chart-axis-label" x={plot.x - 8} y={y + 4} textAnchor="end">{Math.round(max * ratio)} GB</text></g>; })}
    {data.map((item, index) => showAxisLabel(index) ? <text className="chart-axis-label" key={`${item.label}-${index}`} x={point(0, index).x} y={HEIGHT - 8} textAnchor={index === 0 ? "start" : index === data.length - 1 ? "end" : "middle"}>{displayLabel(item)}</text> : null)}
    <path d={area(downloadPoints)} fill="url(#nativeDownloadGradient)" /><path d={area(uploadPoints)} fill="url(#nativeUploadGradient)" /><path className="chart-line chart-line--primary" d={smoothPath(downloadPoints)} /><path className="chart-line chart-line--secondary" d={smoothPath(uploadPoints)} />
    {data.map((item, index) => <g key={`${item.label}-${index}`}><circle className={`chart-point chart-point--primary ${active === index ? "is-active" : ""}`} cx={downloadPoints[index].x} cy={downloadPoints[index].y} r={active === index ? 5 : 3} /><circle className={`chart-point chart-point--secondary ${active === index ? "is-active" : ""}`} cx={uploadPoints[index].x} cy={uploadPoints[index].y} r={active === index ? 5 : 3} /></g>)}
    {selected ? <g className="chart-inspector" pointerEvents="none"><line x1={selectedX} x2={selectedX} y1={plot.y} y2={plot.y + plot.height} /><rect x={tooltipX} y="22" width="148" height="62" rx="16" /><text x={tooltipX + 12} y="40" className="chart-tooltip-title">{displayLabel(selected)}</text><circle cx={tooltipX + 14} cy="55" r="4" className="chart-tooltip-dot chart-tooltip-dot--primary" /><text x={tooltipX + 24} y="59">{t("下载", "Download")} {selected.download.toFixed(2)} GB</text><circle cx={tooltipX + 14} cy="72" r="4" className="chart-tooltip-dot chart-tooltip-dot--secondary" /><text x={tooltipX + 24} y="76">{t("上传", "Upload")} {selected.upload.toFixed(2)} GB</text></g> : null}
    <rect className="chart-hit-area" x={plot.x} y={plot.y} width={plot.width} height={plot.height} />
  </svg></div>;
}
