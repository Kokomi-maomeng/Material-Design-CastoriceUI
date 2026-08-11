import { useI18n } from "../../lib/i18n";
import type { TrafficPoint } from "../../lib/types";

const WIDTH = 680;
const HEIGHT = 270;
const PLOT = { x: 48, y: 16, width: 612, height: 210 };
interface Point { x: number; y: number }

function smoothPath(points: Point[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x},${points[0].y}`;
  return points.slice(1).reduce((path, current, index) => {
    const previous = points[index];
    const mid = (previous.x + current.x) / 2;
    return `${path} C ${mid},${previous.y} ${mid},${current.y} ${current.x},${current.y}`;
  }, `M ${points[0].x},${points[0].y}`);
}

export function TrafficChart({ data }: { data: TrafficPoint[] }) {
  const { t } = useI18n();
  if (data.length === 0) return <div className="chart-empty" role="status">{t("该时间范围正在建立真实采样数据", "Real samples are still being collected for this range")}</div>;
  const rawMax = data.reduce((current, item) => Math.max(current, item.download, item.upload), 1);
  const max = Math.ceil(rawMax / 10) * 10;
  const point = (value: number, index: number): Point => ({ x: PLOT.x + (index / Math.max(1, data.length - 1)) * PLOT.width, y: PLOT.y + PLOT.height - (value / max) * PLOT.height });
  const points = (key: "download" | "upload") => data.map((item, index) => point(item[key], index));
  const downloadPoints = points("download"); const uploadPoints = points("upload");
  const area = (items: Point[]) => `${smoothPath(items)} L ${PLOT.x + PLOT.width},${PLOT.y + PLOT.height} L ${PLOT.x},${PLOT.y + PLOT.height} Z`;

  return <div className="chart chart--traffic"><svg className="native-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={t("上传与下载流量趋势图", "Upload and download traffic trend")}>
    <defs><linearGradient id="nativeDownloadGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-primary)" stopOpacity=".32" /><stop offset="100%" stopColor="var(--chart-primary)" stopOpacity=".02" /></linearGradient><linearGradient id="nativeUploadGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-secondary)" stopOpacity=".22" /><stop offset="100%" stopColor="var(--chart-secondary)" stopOpacity=".01" /></linearGradient></defs>
    {[0, .25, .5, .75, 1].map((ratio) => { const y = PLOT.y + PLOT.height - ratio * PLOT.height; return <g key={ratio}><line className="chart-grid-line" x1={PLOT.x} x2={PLOT.x + PLOT.width} y1={y} y2={y} /><text className="chart-axis-label" x={PLOT.x - 8} y={y + 4} textAnchor="end">{Math.round(max * ratio)} GB</text></g>; })}
    {data.map((item, index) => index % Math.max(1, Math.ceil(data.length / 7)) === 0 ? <text className="chart-axis-label" key={`${item.label}-${index}`} x={point(0, index).x} y={HEIGHT - 8} textAnchor="middle">{item.label}</text> : null)}
    <path d={area(downloadPoints)} fill="url(#nativeDownloadGradient)" /><path d={area(uploadPoints)} fill="url(#nativeUploadGradient)" />
    <path className="chart-line chart-line--primary" d={smoothPath(downloadPoints)} /><path className="chart-line chart-line--secondary" d={smoothPath(uploadPoints)} />
    {data.map((item, index) => <g key={`${item.label}-${index}`}><circle className="chart-point chart-point--primary" cx={downloadPoints[index].x} cy={downloadPoints[index].y} r="3"><title>{t(`${item.label} 下载 ${item.download.toFixed(1)} GB`, `${item.label} download ${item.download.toFixed(1)} GB`)}</title></circle><circle className="chart-point chart-point--secondary" cx={uploadPoints[index].x} cy={uploadPoints[index].y} r="3"><title>{t(`${item.label} 上传 ${item.upload.toFixed(1)} GB`, `${item.label} upload ${item.upload.toFixed(1)} GB`)}</title></circle></g>)}
  </svg></div>;
}
