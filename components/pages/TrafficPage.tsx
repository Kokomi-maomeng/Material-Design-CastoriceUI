"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { formatDecimalBytes } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { DashboardPayload, IntegrationStatus, TrafficRange } from "../../lib/types";
import { DonutChart } from "../charts/DonutChart";
import { TrafficChart } from "../charts/TrafficChart";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Card, CardHeader } from "../ui/Card";
import { AnchoredPopover } from "../ui/AnchoredPopover";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { Progress } from "../ui/Progress";

export function TrafficPage({ traffic, integration, onConfigure }: { traffic: DashboardPayload["traffic"]; integration?: IntegrationStatus; onConfigure: () => void }) {
  const { language, t } = useI18n();
  const [range, setRange] = useState<TrafficRange>("24h");
  const [activeProtocol, setActiveProtocol] = useState<number | null>(null);
  const protocolSurfaceRef = useRef<HTMLDivElement>(null);
  const hourlyTraffic = (traffic.ranges?.["24h"] ?? traffic.hourly).map((item) => ({ ...item, upload: item.upload / 1_000_000_000, download: item.download / 1_000_000_000 }));
  const selectedTraffic = (traffic.ranges?.[range] ?? []).map((item) => ({ ...item, upload: item.upload / 1_000_000_000, download: item.download / 1_000_000_000 }));
  const protocolColors = [
    "var(--chart-primary)",
    "var(--chart-secondary)",
    "var(--chart-tertiary)",
    "color-mix(in srgb, var(--chart-primary) 52%, var(--tertiary))",
    "color-mix(in srgb, var(--chart-secondary) 52%, var(--primary))",
    "color-mix(in srgb, var(--chart-tertiary) 52%, var(--secondary))",
  ];
  const protocolTraffic = traffic.protocol.map((item, index) => ({ ...item, name: t(item.nameZh ?? item.name, item.nameEn ?? item.name), value: item.value / 1_000_000_000, color: protocolColors[index % protocolColors.length] }));
  const accountTraffic = traffic.account.map((item) => ({ ...item, name: t(item.nameZh ?? item.name, item.nameEn ?? item.name), value: item.value / 1_000_000_000 })).sort((left, right) => right.value - left.value || left.name.localeCompare(right.name));
  const protocolTotal = traffic.protocolTotalBytes / 1_000_000_000;
  const accountMax = Math.max(1, ...accountTraffic.map((item) => item.value));
  const monthlyMax = Math.max(0, ...traffic.monthly.map((item) => item.bytes));
  const formatPeriod = (start: string, end: string) => language === "zh"
    ? `${start.split("-").map(Number).join(".")} - ${end.split("-").map(Number).join(".")}`
    : `${start} – ${end}`;
  const formatMonthlyUsage = (bytes: number) => {
    const value = bytes / 1_000_000_000;
    const digits = value >= 100 || value === 0 ? 0 : value >= 10 ? 1 : 2;
    return `${new Intl.NumberFormat(language === "zh" ? "zh-CN" : "en", { maximumFractionDigits: digits }).format(value)} GB`;
  };

  return <div className="page-content page-enter">
    <PageHeader eyebrow={t("用量", "Usage")} title={t("流量分析", "Traffic analytics")} />
    <IntegrationGate status={integration} name="流量采集" nameEn="Traffic collection" description="配置主网卡与流量额度后，才能统计真实用量。" descriptionEn="Configure the primary interface and traffic quota to measure real usage." onConfigure={onConfigure} />
    <section className="traffic-kpis">
      <Kpi label={t("近 24 小时用量", "Last 24 hours")} value={formatDecimalBytes(hourlyTraffic.reduce((sum, item) => sum + item.upload + item.download, 0) * 1_000_000_000)} icon="today" />
      <Kpi
        label={t("主机网卡已测用量", "Measured host-interface usage")}
        value={formatDecimalBytes(traffic.totalBytes)}
        icon="calendar_month"
        coverage={traffic.coverage && !traffic.coverage.complete ? {
          title: t("统计覆盖不完整", "Measurement coverage is incomplete"),
          description: t(`已计入可确认的重置后计数；存在 ${traffic.coverage.gapCount} 个采集间隙，未推算缺失流量。`, `Known post-reset counters are included; ${traffic.coverage.gapCount} collection gap(s) remain and missing traffic was not estimated.`),
        } : undefined}
      />
      <Kpi label={t("协议数据源", "Protocol sources")} value={t(`${protocolTraffic.length} 个`, `${protocolTraffic.length}`)} icon="speed" />
    </section>
    <section className="content-grid content-grid--traffic-main">
      <Card variant="outlined" className="traffic-trend-panel">
        <CardHeader title={t("流量趋势", "Traffic trend")} action={<div className="segmented-control traffic-range-control">{(["1h", "6h", "24h", "3day", "7day"] as const).map((item) => <button key={item} className={range === item ? "is-selected" : ""} onClick={() => setRange(item)}>{item === "3day" ? t("3天", "3 days") : item === "7day" ? t("7天", "7 days") : item}</button>)}</div>} />
        <div className="legend-inline legend-inline--chart"><span className="dot dot--primary" />{t("下载", "Download")}<span className="dot dot--secondary" />{t("上传", "Upload")}</div>
        <TrafficChart data={selectedTraffic} />
      </Card>
    </section>
    <section className="content-grid content-grid--traffic-secondary">
      <CollapsibleTrafficCard
        className="monthly-traffic-panel"
        title={t("近期月流量", "Recent monthly traffic")}
      >
        <div className="monthly-traffic-list">
          {traffic.monthly.map((item) => {
            const width = monthlyMax > 0 ? (item.bytes / monthlyMax) * 100 : 0;
            return <div className="monthly-traffic-row" key={item.startDate}>
              <time dateTime={item.startDate}>{formatPeriod(item.startDate, item.endDate)}</time>
              <div className="monthly-traffic-track" role="meter" aria-label={t(`${formatPeriod(item.startDate, item.endDate)} 流量`, `${formatPeriod(item.startDate, item.endDate)} traffic`)} aria-valuemin={0} aria-valuemax={monthlyMax} aria-valuenow={item.bytes}>
                <span style={{ width: `${width}%`, minWidth: item.bytes > 0 ? 3 : 0 }} />
              </div>
              <strong>{formatMonthlyUsage(item.bytes)}{item.coverage && !item.coverage.complete ? ` ${t("（部分）", "(partial)")}` : ""}</strong>
            </div>;
          })}
        </div>
      </CollapsibleTrafficCard>
      <Card ref={protocolSurfaceRef} variant="filled" className="protocol-panel" onPointerLeave={() => setActiveProtocol(null)} onPointerCancel={() => setActiveProtocol(null)}>
        <CardHeader title={t("协议分布", "Protocol distribution")} />
        <DonutChart data={protocolTraffic} centerLabel={t("分布合计", "Distribution total")} centerValue={`${protocolTotal.toFixed(0)} GB`} active={activeProtocol} onActiveChange={setActiveProtocol} surfaceRef={protocolSurfaceRef} />
      </Card>
    </section>
    <section className="content-grid content-grid--traffic-bottom">
      <CollapsibleTrafficCard title={t("管理账号用量排行", "Managed-account usage ranking")}>
        <div className="ranking-list">{accountTraffic.map((item, index) => <div className="ranking-row" key={item.name}><span className="rank">{index + 1}</span><div><strong>{item.name}</strong><Progress value={(item.value / accountMax) * 100} /></div><b>{item.value.toFixed(1)} GB</b></div>)}</div>
      </CollapsibleTrafficCard>
    </section>
  </div>;
}

function CollapsibleTrafficCard({ title, className = "", children }: { title: string; className?: string; children: ReactNode }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);
  return <section className={`md-card md-card--outlined traffic-disclosure ${expanded ? "is-expanded" : "is-collapsed"} ${className}`}>
    <button type="button" className="traffic-disclosure__summary" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)}>
      <h2>{title}</h2>
      <span className="traffic-disclosure__action"><Icon name="expand_more" /></span>
      <span className="sr-only">{t("展开或折叠卡片", "Expand or collapse card")}</span>
    </button>
    <div className="traffic-disclosure__collapse" aria-hidden={!expanded} inert={expanded ? undefined : true}><div className="traffic-disclosure__content">{children}</div></div>
  </section>;
}

function Kpi({ label, value, icon, coverage }: { label: string; value: string; icon: string; coverage?: { title: string; description: string } }) {
  const popupId = useId();
  const cardRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);
  const close = useCallback(() => {
    cancelClose();
    setOpen(false);
  }, [cancelClose]);
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(close, 140);
  };
  useEffect(() => () => cancelClose(), [cancelClose]);

  return <Card ref={cardRef} className="traffic-kpi" variant="filled"><span><Icon name={icon} /></span><div><small><span>{label}</span>{coverage ? <button
    ref={buttonRef}
    type="button"
    className="traffic-coverage-trigger"
    aria-label={coverage.title}
    aria-expanded={open}
    aria-controls={popupId}
    onPointerEnter={(event) => { if (event.pointerType === "mouse") { cancelClose(); setOpen(true); } }}
    onPointerLeave={(event) => { if (event.pointerType === "mouse") scheduleClose(); }}
    onPointerUp={(event) => { if (event.pointerType !== "mouse") setOpen((value) => !value); }}
    onClick={(event) => { if (event.detail === 0) setOpen(true); }}
  ><Icon name="info" size={17} /></button> : null}</small><strong>{value}</strong></div>{coverage ? <AnchoredPopover
    open={open}
    anchorRef={buttonRef}
    surfaceRef={cardRef}
    placementPreference="vertical"
    onClose={close}
    ariaLabel={coverage.title}
    className="traffic-coverage-popover"
    onPointerEnter={cancelClose}
    onPointerLeave={scheduleClose}
  ><div id={popupId}><strong>{coverage.title}</strong><p>{coverage.description}</p></div></AnchoredPopover> : null}</Card>;
}
