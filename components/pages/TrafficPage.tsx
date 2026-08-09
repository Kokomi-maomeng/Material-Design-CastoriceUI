"use client";

import { useState } from "react";
import { accountTraffic, dailyTraffic, hourlyTraffic, protocolTraffic } from "../../lib/demo-data";
import { DonutChart } from "../charts/DonutChart";
import { TrafficChart } from "../charts/TrafficChart";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { Progress } from "../ui/Progress";

export function TrafficPage({ onToast }: { onToast: (message: string) => void }) {
  const [range, setRange] = useState<"day" | "month">("day");
  const total = protocolTraffic.reduce((sum, item) => sum + item.value, 0);
  const accountMax = Math.max(...accountTraffic.map((item) => item.value));

  return (
    <div className="page-content page-enter">
      <PageHeader eyebrow="用量洞察" title="流量分析" description="按时间、账号与代理协议了解流量去向和增长趋势。" actions={<Button variant="outlined" icon="download" onClick={() => onToast("报告导出需要由后端生成完整数据")}>导出报告</Button>} />
      <section className="traffic-kpis">
        <Kpi label="今日总流量" value="29.7 GB" icon="today" change="较昨日 +8.2%" />
        <Kpi label="本月总流量" value="366.2 GB" icon="calendar_month" change="日均 12.2 GB" />
        <Kpi label="峰值速率" value="84.6 MB/s" icon="speed" change="20:18 发生" />
        <Kpi label="预测月底" value="812 GB" icon="query_stats" change="低于 1 TB 限额" positive />
      </section>
      <section className="content-grid content-grid--traffic-main">
        <Card variant="outlined" className="traffic-trend-panel">
          <CardHeader title="流量趋势" description={range === "day" ? "今日 · 每 2 小时聚合" : "最近 14 天 · 每日聚合"} action={<div className="segmented-control"><button className={range === "day" ? "is-selected" : ""} onClick={() => setRange("day")}>今日</button><button className={range === "month" ? "is-selected" : ""} onClick={() => setRange("month")}>本月</button></div>} />
          <div className="legend-inline legend-inline--chart"><span className="dot dot--primary" />下载<span className="dot dot--secondary" />上传</div>
          <TrafficChart data={range === "day" ? hourlyTraffic : dailyTraffic} />
        </Card>
        <Card variant="filled" className="protocol-panel">
          <CardHeader title="协议分布" description="本月累计流量" />
          <DonutChart data={protocolTraffic} centerLabel="总流量" centerValue={`${total.toFixed(0)} GB`} />
        </Card>
      </section>
      <section className="content-grid content-grid--traffic-bottom">
        <Card variant="outlined">
          <CardHeader title="账号用量排行" description="本计费周期" action={<Chip staticChip>4 个账号</Chip>} />
          <div className="ranking-list">{accountTraffic.map((item, index) => <div className="ranking-row" key={item.name}><span className="rank">{index + 1}</span><div><strong>{item.name}</strong><Progress value={(item.value / accountMax) * 100} /></div><b>{item.value.toFixed(1)} GB</b></div>)}</div>
        </Card>
        <Card variant="filled" className="forecast-card">
          <span className="forecast-card__icon"><Icon name="auto_graph" size={28} /></span>
          <div><p>预计耗尽日期</p><strong>2026年9月3日</strong><span>基于最近 7 天日均 21.4 GB 计算</span></div>
          <div className="forecast-card__note"><Icon name="lightbulb" size={20} filled /><span>若保持当前用量，本周期预计剩余约 188 GB。</span></div>
        </Card>
      </section>
    </div>
  );
}

function Kpi({ label, value, icon, change, positive }: { label: string; value: string; icon: string; change: string; positive?: boolean }) {
  return <Card className="traffic-kpi" variant="filled"><span><Icon name={icon} /></span><div><small>{label}</small><strong>{value}</strong><em className={positive ? "positive" : ""}>{change}</em></div></Card>;
}
