"use client";

interface DonutItem { name: string; value: number; color: string }

export function DonutChart({ data, centerLabel, centerValue }: { data: DonutItem[]; centerLabel: string; centerValue: string }) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const radius = 72;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="donut-wrap">
      <div className="chart chart--donut">
        <svg className="native-donut" viewBox="0 0 200 200" role="img" aria-label={`${centerLabel}分布图`}>
          <circle className="donut-track" cx="100" cy="100" r={radius} />
          {data.map((item, index) => {
            const fraction = total > 0 ? item.value / total : 0;
            const length = Math.max(0, fraction * circumference - 3);
            const preceding = data.slice(0, index).reduce((sum, entry) => sum + entry.value, 0);
            const dashOffset = total > 0 ? -(preceding / total) * circumference : 0;
            return <circle key={item.name} className="donut-segment" cx="100" cy="100" r={radius} stroke={item.color} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={dashOffset}><title>{`${item.name} ${item.value.toFixed(1)} GB`}</title></circle>;
          })}
        </svg>
        <div className="donut-center"><strong>{centerValue}</strong><span>{centerLabel}</span></div>
      </div>
      <div className="chart-legend">
        {data.map((item) => <span key={item.name}><i style={{ background: item.color }} />{item.name}<b>{item.value.toFixed(1)} GB</b></span>)}
      </div>
    </div>
  );
}
