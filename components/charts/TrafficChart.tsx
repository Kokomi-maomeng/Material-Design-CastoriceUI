import type { TrafficPoint } from "../../lib/types";

const WIDTH = 680;
const HEIGHT = 270;
const PLOT = { x: 48, y: 16, width: 612, height: 210 };

export function TrafficChart({ data }: { data: TrafficPoint[] }) {
  if (data.length === 0) return <div className="chart-empty" role="status">该时间范围正在建立真实采样数据</div>;
  const rawMax = data.reduce((current, item) => Math.max(current, item.download, item.upload), 1);
  const max = Math.ceil(rawMax / 10) * 10;
  const point = (value: number, index: number) => ({
    x: PLOT.x + (index / Math.max(1, data.length - 1)) * PLOT.width,
    y: PLOT.y + PLOT.height - (value / max) * PLOT.height,
  });
  const line = (key: "download" | "upload") => data.map((item, index) => {
    const { x, y } = point(item[key], index);
    return `${x},${y}`;
  }).join(" ");
  const area = (key: "download" | "upload") => `${PLOT.x},${PLOT.y + PLOT.height} ${line(key)} ${PLOT.x + PLOT.width},${PLOT.y + PLOT.height}`;

  return (
    <div className="chart chart--traffic">
      <svg className="native-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="上传与下载流量趋势图">
        <defs>
          <linearGradient id="nativeDownloadGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-primary)" stopOpacity=".32" /><stop offset="100%" stopColor="var(--chart-primary)" stopOpacity=".02" /></linearGradient>
          <linearGradient id="nativeUploadGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--chart-secondary)" stopOpacity=".22" /><stop offset="100%" stopColor="var(--chart-secondary)" stopOpacity=".01" /></linearGradient>
        </defs>
        {[0, .25, .5, .75, 1].map((ratio) => {
          const y = PLOT.y + PLOT.height - ratio * PLOT.height;
          return <g key={ratio}><line className="chart-grid-line" x1={PLOT.x} x2={PLOT.x + PLOT.width} y1={y} y2={y} /><text className="chart-axis-label" x={PLOT.x - 8} y={y + 4} textAnchor="end">{Math.round(max * ratio)} GB</text></g>;
        })}
        {data.map((item, index) => index % Math.max(1, Math.ceil(data.length / 7)) === 0 ? <text className="chart-axis-label" key={item.label} x={point(0, index).x} y={HEIGHT - 8} textAnchor="middle">{item.label}</text> : null)}
        <polygon points={area("download")} fill="url(#nativeDownloadGradient)" />
        <polygon points={area("upload")} fill="url(#nativeUploadGradient)" />
        <polyline className="chart-line chart-line--primary" points={line("download")} />
        <polyline className="chart-line chart-line--secondary" points={line("upload")} />
        {data.map((item, index) => <g key={item.label}>
          <circle className="chart-point chart-point--primary" cx={point(item.download, index).x} cy={point(item.download, index).y} r="4"><title>{`${item.label} 下载 ${item.download.toFixed(1)} GB`}</title></circle>
          <circle className="chart-point chart-point--secondary" cx={point(item.upload, index).x} cy={point(item.upload, index).y} r="4"><title>{`${item.label} 上传 ${item.upload.toFixed(1)} GB`}</title></circle>
        </g>)}
      </svg>
    </div>
  );
}
