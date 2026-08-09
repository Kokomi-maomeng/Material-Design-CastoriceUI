const WIDTH = 600;
const HEIGHT = 220;
const PLOT = { x: 45, y: 14, width: 535, height: 170 };

export function ResourceChart({ data }: { data: Array<{ label: string; cpu: number; memory: number }> }) {
  const point = (value: number, index: number) => ({
    x: PLOT.x + (index / Math.max(1, data.length - 1)) * PLOT.width,
    y: PLOT.y + PLOT.height - (value / 100) * PLOT.height,
  });
  const line = (key: "cpu" | "memory") => data.map((item, index) => {
    const { x, y } = point(item[key], index);
    return `${x},${y}`;
  }).join(" ");

  return (
    <div className="chart chart--resource">
      <svg className="native-chart" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="CPU 与内存使用率趋势图">
        {[0, 25, 50, 75, 100].map((value) => {
          const y = PLOT.y + PLOT.height - (value / 100) * PLOT.height;
          return <g key={value}><line className="chart-grid-line" x1={PLOT.x} x2={PLOT.x + PLOT.width} y1={y} y2={y} /><text className="chart-axis-label" x={PLOT.x - 8} y={y + 4} textAnchor="end">{value}%</text></g>;
        })}
        {data.map((item, index) => index % 2 === 0 ? <text className="chart-axis-label" key={item.label} x={point(0, index).x} y={HEIGHT - 8} textAnchor="middle">{item.label}</text> : null)}
        <polyline className="chart-line chart-line--primary" points={line("cpu")} />
        <polyline className="chart-line chart-line--tertiary" points={line("memory")} />
        {data.map((item, index) => <g key={item.label}>
          <circle className="chart-point chart-point--primary" cx={point(item.cpu, index).x} cy={point(item.cpu, index).y} r="4"><title>{`${item.label} CPU ${item.cpu}%`}</title></circle>
          <circle className="chart-point chart-point--tertiary" cx={point(item.memory, index).x} cy={point(item.memory, index).y} r="4"><title>{`${item.label} 内存 ${item.memory}%`}</title></circle>
        </g>)}
      </svg>
    </div>
  );
}
