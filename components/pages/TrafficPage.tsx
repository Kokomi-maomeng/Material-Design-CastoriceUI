"use client";

import { useState } from "react";
import { formatDecimalBytes } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { DashboardPayload, IntegrationStatus, TrafficRange } from "../../lib/types";
import { DonutChart } from "../charts/DonutChart";
import { TrafficChart } from "../charts/TrafficChart";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Card, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { Progress } from "../ui/Progress";

export function TrafficPage({ traffic, integration, onConfigure }: { traffic: DashboardPayload["traffic"]; integration?: IntegrationStatus; onConfigure: () => void }) {
  const { t } = useI18n();
  const [range, setRange] = useState<TrafficRange>("24h");
  const hourlyTraffic = (traffic.ranges?.["24h"] ?? traffic.hourly).map((item) => ({ ...item, upload: item.upload / 1_000_000_000, download: item.download / 1_000_000_000 }));
  const selectedTraffic = (traffic.ranges?.[range] ?? []).map((item) => ({ ...item, upload: item.upload / 1_000_000_000, download: item.download / 1_000_000_000 }));
  const protocolTraffic = traffic.protocol.map((item, index) => ({ ...item, name: t(item.nameZh ?? item.name, item.nameEn ?? item.name), value: item.value / 1_000_000_000, color: ["var(--chart-primary)", "var(--chart-secondary)", "var(--chart-tertiary)"][index % 3] }));
  const accountTraffic = traffic.account.map((item) => ({ ...item, name: t(item.nameZh ?? item.name, item.nameEn ?? item.name), value: item.value / 1_000_000_000 })).sort((left, right) => right.value - left.value || left.name.localeCompare(right.name));
  const total = traffic.totalBytes / 1_000_000_000;
  const accountMax = Math.max(1, ...accountTraffic.map((item) => item.value));

  return <div className="page-content page-enter">
    <PageHeader eyebrow={t("用量", "Usage")} title={t("流量分析", "Traffic analytics")} />
    <IntegrationGate status={integration} name="流量采集" nameEn="Traffic collection" description="尚未配置流量采集。" descriptionEn="Traffic collection is not configured." onConfigure={onConfigure} />
    <section className="traffic-kpis">
      <Kpi label={t("近 24 小时用量", "Last 24 hours")} value={formatDecimalBytes(hourlyTraffic.reduce((sum, item) => sum + item.upload + item.download, 0) * 1_000_000_000)} icon="today" />
      <Kpi label={t("统一累计统计", "Unified cumulative total")} value={formatDecimalBytes(traffic.totalBytes)} icon="calendar_month" />
      <Kpi label={t("协议数据源", "Protocol sources")} value={t(`${protocolTraffic.length} 个`, `${protocolTraffic.length}`)} icon="speed" />
    </section>
    <section className="content-grid content-grid--traffic-main">
      <Card variant="outlined" className="traffic-trend-panel">
        <CardHeader title={t("流量趋势", "Traffic trend")} action={<div className="segmented-control traffic-range-control">{(["1h", "6h", "24h", "3day", "7day"] as const).map((item) => <button key={item} className={range === item ? "is-selected" : ""} onClick={() => setRange(item)}>{item === "3day" ? t("3天", "3 days") : item === "7day" ? t("7天", "7 days") : item}</button>)}</div>} />
        <div className="legend-inline legend-inline--chart"><span className="dot dot--primary" />{t("下载", "Download")}<span className="dot dot--secondary" />{t("上传", "Upload")}</div>
        <TrafficChart data={selectedTraffic} />
      </Card>
      <Card variant="filled" className="protocol-panel">
        <CardHeader title={t("协议分布", "Protocol distribution")} />
        <DonutChart data={protocolTraffic} centerLabel={t("总流量", "Total")} centerValue={`${total.toFixed(0)} GB`} />
      </Card>
    </section>
    <section className="content-grid content-grid--traffic-bottom">
      <Card variant="outlined">
        <CardHeader title={t("管理账号用量排行", "Managed-account usage ranking")} action={<Chip staticChip>{t(`${accountTraffic.length} 项归属`, accountTraffic.length === 1 ? "1 attribution entry" : `${accountTraffic.length} attribution entries`)}</Chip>} />
        <div className="ranking-list">{accountTraffic.map((item, index) => <div className="ranking-row" key={item.name}><span className="rank">{index + 1}</span><div><strong>{item.name}</strong><Progress value={(item.value / accountMax) * 100} /></div><b>{item.value.toFixed(1)} GB</b></div>)}</div>
      </Card>
    </section>
  </div>;
}

function Kpi({ label, value, icon }: { label: string; value: string; icon: string }) {
  return <Card className="traffic-kpi" variant="filled"><span><Icon name={icon} /></span><div><small>{label}</small><strong>{value}</strong></div></Card>;
}
