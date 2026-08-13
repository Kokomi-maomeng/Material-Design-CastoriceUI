"use client";

import { useState } from "react";
import { useI18n } from "../../lib/i18n";
import type { DashboardPayload, IntegrationStatus, TrafficRange } from "../../lib/types";
import { formatDecimalBytes } from "../../lib/format";
import { IntegrationGate } from "../setup/IntegrationGate";
import { DonutChart } from "../charts/DonutChart";
import { TrafficChart } from "../charts/TrafficChart";
import { Card, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { Progress } from "../ui/Progress";

export function TrafficPage({ traffic, integration, onConfigure }: { onToast: (message: string) => void; traffic: DashboardPayload["traffic"]; integration?: IntegrationStatus; onConfigure: () => void }) {
  const { t } = useI18n();
  const [range, setRange] = useState<TrafficRange>("24h");
  const hourlyTraffic = (traffic.ranges?.["24h"] ?? traffic.hourly).map((item) => ({ ...item, upload: item.upload / 1_000_000_000, download: item.download / 1_000_000_000 }));
  const dailyTraffic = (traffic.ranges?.["7day"] ?? traffic.daily).map((item) => ({ ...item, upload: item.upload / 1_000_000_000, download: item.download / 1_000_000_000 }));
  const selectedTraffic = (traffic.ranges?.[range] ?? []).map((item) => ({ ...item, upload: item.upload / 1_000_000_000, download: item.download / 1_000_000_000 }));
  const protocolTraffic = traffic.protocol.map((item, index) => ({ ...item, value: item.value / 1_000_000_000, color: ["var(--chart-primary)", "var(--chart-secondary)", "var(--chart-tertiary)"][index % 3] }));
  const accountTraffic = traffic.account.map((item) => ({ ...item, value: item.value / 1_000_000_000 }));
  const total = protocolTraffic.reduce((sum, item) => sum + item.value, 0);
  const accountMax = Math.max(1, ...accountTraffic.map((item) => item.value));

  return (
    <div className="page-content page-enter">
      <PageHeader eyebrow={t("用量洞察", "Usage insights")} title={t("流量分析", "Traffic analytics")} description={t("按时间、账号与代理协议查看真实用量和增长趋势。", "Review real usage and growth by time, account, and proxy protocol.")} />
      <IntegrationGate status={integration} name="流量采集" nameEn="Traffic collection" description="后台每分钟采集真实网卡计数器；协议与账号分类只使用核心返回的累计值。" descriptionEn="The backend records real interface counters every minute. Protocol and account breakdowns use only cumulative values returned by the cores." onConfigure={onConfigure} />
      <section className="traffic-kpis">
        <Kpi label={t("近 24 小时用量", "Last 24 hours")} value={formatDecimalBytes(hourlyTraffic.reduce((sum, item) => sum + item.upload + item.download, 0) * 1_000_000_000)} icon="today" change={t("真实网卡增量", "Real interface deltas")} />
        <Kpi label={t("核心累计统计", "Core cumulative total")} value={formatDecimalBytes(total * 1_000_000_000)} icon="calendar_month" change={t("协议 API 当前累计值", "Current protocol API totals")} />
        <Kpi label={t("协议数据源", "Protocol sources")} value={t(`${protocolTraffic.length} 个`, `${protocolTraffic.length}`)} icon="speed" change={t("实时聚合", "Live aggregation")} />
        <Kpi label={t("趋势采样", "Trend samples")} value={t(`${dailyTraffic.length} 个时间桶`, `${dailyTraffic.length} time buckets`)} icon="query_stats" change={t("每分钟持续采集", "Collected every minute")} positive />
      </section>
      <section className="content-grid content-grid--traffic-main">
        <Card variant="outlined" className="traffic-trend-panel">
          <CardHeader title={t("流量趋势", "Traffic trend")} description={t("真实网卡计数器增量；区间越长，时间桶越大", "Real interface counter deltas; longer ranges use larger time buckets")} action={<div className="segmented-control traffic-range-control">{(["1h", "6h", "24h", "3day", "7day"] as const).map((item) => <button key={item} className={range === item ? "is-selected" : ""} onClick={() => setRange(item)}>{item === "3day" ? t("3天", "3 days") : item === "7day" ? t("7天", "7 days") : item}</button>)}</div>} />
          <div className="legend-inline legend-inline--chart"><span className="dot dot--primary" />{t("下载", "Download")}<span className="dot dot--secondary" />{t("上传", "Upload")}</div>
          <TrafficChart data={selectedTraffic} />
        </Card>
        <Card variant="filled" className="protocol-panel">
          <CardHeader title={t("协议分布", "Protocol distribution")} description={t("协议核心当前累计值；不等同于计费周期", "Current cumulative core values; not a billing cycle")} />
          <DonutChart data={protocolTraffic} centerLabel={t("总流量", "Total")} centerValue={`${total.toFixed(0)} GB`} />
        </Card>
      </section>
      <section className="content-grid content-grid--traffic-bottom">
        <Card variant="outlined">
          <CardHeader title={t("账号用量排行", "Account usage ranking")} description={t("Hysteria2 核心当前累计值；没有身份映射时保持为 0，不猜测账号", "Current Hysteria2 core totals. Accounts remain zero without an identity mapping; identities are never guessed.")} action={<Chip staticChip>{t(`${accountTraffic.length} 个账号`, `${accountTraffic.length} accounts`)}</Chip>} />
          <div className="ranking-list">{accountTraffic.map((item, index) => <div className="ranking-row" key={item.name}><span className="rank">{index + 1}</span><div><strong>{item.name}</strong><Progress value={(item.value / accountMax) * 100} /></div><b>{item.value.toFixed(1)} GB</b></div>)}</div>
        </Card>
        <Card variant="filled" className="forecast-card">
          <span className="forecast-card__icon"><Icon name="auto_graph" size={28} /></span>
          <div><p>{t("容量预测", "Capacity forecast")}</p><strong>{dailyTraffic.length >= 2 ? t("趋势已建立", "Trend established") : t("持续采样中", "Collecting samples")}</strong><span>{t("更多真实时间桶会让趋势判断更稳定", "More real time buckets improve trend stability")}</span></div>
          <div className="forecast-card__note"><Icon name="lightbulb" size={20} filled /><span>{t("总览显示重启可连续累计的本机估算；覆盖不完整时不会冒充运营商账单。", "Overview shows a reset-safe local estimate and never presents incomplete coverage as a provider bill.")}</span></div>
        </Card>
      </section>
    </div>
  );
}

function Kpi({ label, value, icon, change, positive }: { label: string; value: string; icon: string; change: string; positive?: boolean }) {
  return <Card className="traffic-kpi" variant="filled"><span><Icon name={icon} /></span><div><small>{label}</small><strong>{value}</strong><em className={positive ? "positive" : ""}>{change}</em></div></Card>;
}
