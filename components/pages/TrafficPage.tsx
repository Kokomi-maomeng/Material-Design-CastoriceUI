"use client";

import { useState } from "react";
import type { DashboardPayload, IntegrationStatus } from "../../lib/types";
import { formatBytes } from "../../lib/format";
import { FeatureIntro } from "../setup/FeatureIntro";
import { IntegrationGate } from "../setup/IntegrationGate";
import { DonutChart } from "../charts/DonutChart";
import { TrafficChart } from "../charts/TrafficChart";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { Progress } from "../ui/Progress";

export function TrafficPage({ onToast, traffic, integration, onConfigure }: { onToast: (message: string) => void; traffic: DashboardPayload["traffic"]; integration?: IntegrationStatus; onConfigure: () => void }) {
  const [range, setRange] = useState<"day" | "month">("day");
  const hourlyTraffic = traffic.hourly.map((item) => ({ ...item, upload: item.upload / 1024 ** 3, download: item.download / 1024 ** 3 }));
  const dailyTraffic = traffic.daily.map((item) => ({ ...item, upload: item.upload / 1024 ** 3, download: item.download / 1024 ** 3 }));
  const protocolTraffic = traffic.protocol.map((item, index) => ({ ...item, value: item.value / 1024 ** 3, color: ["var(--chart-primary)", "var(--chart-secondary)", "var(--chart-tertiary)"][index % 3] }));
  const accountTraffic = traffic.account.map((item) => ({ ...item, value: item.value / 1024 ** 3 }));
  const total = protocolTraffic.reduce((sum, item) => sum + item.value, 0);
  const accountMax = Math.max(1, ...accountTraffic.map((item) => item.value));

  return (
    <div className="page-content page-enter">
      <PageHeader eyebrow="用量洞察" title="流量分析" description="按时间、账号与代理协议了解流量去向和增长趋势。" actions={<Button variant="outlined" icon="download" onClick={() => onToast("报告导出需要由后端生成完整数据")}>导出报告</Button>} />
      <IntegrationGate status={integration} name="流量采集" description="启用网卡采样并连接协议统计后，趋势和分类会切换为真实数据。" onConfigure={onConfigure} />
      <FeatureIntro items={[{ icon: "timeline", title: "小时与天趋势", description: "持续采样服务器计数器，形成短期与月度走势。" }, { icon: "donut_large", title: "协议分类", description: "对比 Hysteria2、AnyTLS 与扩展协议的用量。" }, { icon: "group", title: "账号排行", description: "发现异常增长并辅助设置配额。" }]} />
      <section className="traffic-kpis">
        <Kpi label="今日采样" value={formatBytes(hourlyTraffic.reduce((sum, item) => sum + item.upload + item.download, 0) * 1024 ** 3)} icon="today" change="来自后端采样" />
        <Kpi label="周期统计" value={formatBytes(total * 1024 ** 3)} icon="calendar_month" change="协议 API 汇总" />
        <Kpi label="协议数据源" value={`${protocolTraffic.length} 个`} icon="speed" change="实时聚合" />
        <Kpi label="趋势采样" value={`${dailyTraffic.length} 天`} icon="query_stats" change="持续写入 SQLite" positive />
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
          <CardHeader title="账号用量排行" description="本计费周期" action={<Chip staticChip>{accountTraffic.length} 个账号</Chip>} />
          <div className="ranking-list">{accountTraffic.map((item, index) => <div className="ranking-row" key={item.name}><span className="rank">{index + 1}</span><div><strong>{item.name}</strong><Progress value={(item.value / accountMax) * 100} /></div><b>{item.value.toFixed(1)} GB</b></div>)}</div>
        </Card>
        <Card variant="filled" className="forecast-card">
          <span className="forecast-card__icon"><Icon name="auto_graph" size={28} /></span>
          <div><p>容量预测</p><strong>{dailyTraffic.length >= 2 ? "趋势已建立" : "持续采样中"}</strong><span>至少两个日采样点后生成更稳定的耗尽预测</span></div>
          <div className="forecast-card__note"><Icon name="lightbulb" size={20} filled /><span>总览会结合月度额度与当前累计用量显示剩余空间。</span></div>
        </Card>
      </section>
    </div>
  );
}

function Kpi({ label, value, icon, change, positive }: { label: string; value: string; icon: string; change: string; positive?: boolean }) {
  return <Card className="traffic-kpi" variant="filled"><span><Icon name={icon} /></span><div><small>{label}</small><strong>{value}</strong><em className={positive ? "positive" : ""}>{change}</em></div></Card>;
}
