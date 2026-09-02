"use client";

import { useI18n } from "../../lib/i18n";
interface DonutItem { name: string; value: number; color: string }

export function DonutChart({ data, centerLabel, centerValue, active, onActiveChange: setActive }: { active: number | null; onActiveChange: (value: number | null) => void; data: DonutItem[]; centerLabel: string; centerValue: string }) {
  const { t } = useI18n();
  const total = data.reduce((sum, item) => sum + item.value, 0); const radius = 72; const circumference = 2 * Math.PI * radius; const selected = active === null ? null : data[active];
  return <div className="donut-wrap"><div className="chart chart--donut"><svg className="native-donut native-chart--interactive" viewBox="0 0 200 200" role="img" tabIndex={0} aria-label={t(`${centerLabel}分布图，可聚焦图例查看数值`, `${centerLabel} distribution chart; focus segments to inspect values`)} onKeyDown={(event) => { if (event.key === "Escape") setActive(null); }} onBlur={() => setActive(null)}>
    <circle className="donut-track" cx="100" cy="100" r={radius} />
    {data.map((item, index) => { const fraction = total > 0 ? item.value / total : 0; const length = Math.max(0, fraction * circumference - 3); const preceding = data.slice(0, index).reduce((sum, entry) => sum + entry.value, 0); const dashOffset = total > 0 ? -(preceding / total) * circumference : 0; return <circle key={item.name} className={`donut-segment ${active === index ? "is-active" : ""}`} cx="100" cy="100" r={radius} stroke={item.color} strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={dashOffset} tabIndex={0} onPointerEnter={() => setActive(index)} onPointerDown={() => setActive(index)} onFocus={() => setActive(index)} />; })}
  </svg><div className={`donut-center ${selected ? "is-inspecting" : ""}`}><strong>{selected ? `${selected.value.toFixed(2)} GB` : centerValue}</strong><span>{selected?.name ?? centerLabel}</span></div></div>
  <div className="chart-legend">{data.map((item, index) => <button type="button" key={item.name} onPointerEnter={() => setActive(index)} onPointerLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}><span><i style={{ background: item.color }} />{item.name}</span><b>{item.value.toFixed(1)} GB</b></button>)}</div></div>;
}
