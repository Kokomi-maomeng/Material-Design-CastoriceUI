"use client";

import { useCallback, useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { formatDecimalBytes } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { DashboardPayload, IntegrationStatus, TrafficRange } from "../../lib/types";
import { ProtocolDistribution } from "../charts/ProtocolDistribution";
import { TrafficChart } from "../charts/TrafficChart";
import { IntegrationGate } from "../setup/IntegrationGate";
import { ActiveConnections } from "../traffic/ActiveConnections";
import { AnchoredPopover } from "../ui/AnchoredPopover";
import { Card, CardHeader } from "../ui/Card";
import { Collapse } from "../ui/Collapse";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

export function TrafficPage({ traffic, integration, onConfigure, activity }: { traffic: DashboardPayload["traffic"]; integration?: IntegrationStatus; onConfigure: () => void; activity?: ComponentProps<typeof ActiveConnections> }) {
  const { language, t } = useI18n();
  const [range, setRange] = useState<TrafficRange>("24h");
  const [expanded, setExpanded] = useState(true);
  const detailsId = useId();
  const hourlyTraffic = traffic.ranges?.["24h"] ?? traffic.hourly;
  const selectedTraffic = (traffic.ranges?.[range] ?? []).map((item) => ({ ...item, upload: item.upload / 1_000_000_000, download: item.download / 1_000_000_000 }));
  const monthlyMax = Math.max(0, ...traffic.monthly.map((item) => item.bytes));
  const formatPeriod = (start: string, end: string) => language === "zh"
    ? `${start.split("-").map(Number).join(".")} - ${end.split("-").map(Number).join(".")}`
    : `${start} – ${end}`;

  return <div className="page-content page-enter">
    <PageHeader eyebrow={t("用量", "Usage")} title={t("流量分析", "Traffic analytics")} />
    <IntegrationGate status={integration} name="流量采集" nameEn="Traffic collection" description="配置主网卡与流量额度后，才能统计真实用量。" descriptionEn="Configure the primary interface and traffic quota to measure real usage." onConfigure={onConfigure} />
    <section className="traffic-kpis">
      <Kpi label={t("近 24h 用量", "Last 24h usage")} value={formatDecimalBytes(hourlyTraffic.reduce((sum, item) => sum + item.upload + item.download, 0))} icon="today" />
      <Kpi
        label={t("主机网卡已测用量", "Measured host-interface usage")}
        value={formatDecimalBytes(traffic.totalBytes)}
        icon="calendar_month"
        coverage={traffic.coverage && !traffic.coverage.complete ? {
          title: t("统计覆盖不完整", "Measurement coverage is incomplete"),
          description: t(`已计入可确认的重置后计数；存在 ${traffic.coverage.gapCount} 个采集间隙，未推算缺失流量。`, `Known post-reset counters are included. There are ${traffic.coverage.gapCount} collection gaps with no estimated traffic.`),
        } : undefined}
      />
      <Kpi label={t("协议数据源", "Protocol sources")} value={String(traffic.protocol.length)} icon="speed" />
    </section>
    <Card variant="outlined" className="traffic-analysis">
      <h2 className="traffic-analysis__heading"><button className="traffic-analysis__toggle" type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => setExpanded((value) => !value)}>
        {t("用量明细", "Usage details")}<Icon name="expand_more" />
      </button></h2>
      <Collapse expanded={expanded}>
        <div className="traffic-analysis__grid" id={detailsId}>
          <Card variant="filled" className="traffic-analysis__trend">
            <CardHeader title={t("流量趋势", "Traffic trend")} action={<div className="segmented-control traffic-range-control" role="group" aria-label={t("流量趋势时间范围", "Traffic trend range")}>{(["1h", "6h", "24h", "3day", "7day"] as const).map((item) => <button type="button" key={item} className={range === item ? "is-selected" : ""} aria-pressed={range === item} onClick={() => setRange(item)}>{item === "3day" ? "3d" : item === "7day" ? "7d" : item}</button>)}</div>} />
            <div className="legend-inline legend-inline--chart"><span className="dot dot--primary" />{t("下载", "Download")}<span className="dot dot--secondary" />{t("上传", "Upload")}</div>
            <TrafficChart data={selectedTraffic} />
          </Card>
          <Card variant="filled" className="monthly-traffic-panel">
            <CardHeader title={t("近期月流量", "Recent monthly traffic")} />
            <div className="monthly-traffic-list">
              {traffic.monthly.map((item) => {
                const period = formatPeriod(item.startDate, item.endDate);
                const usage = `${(item.bytes / 1_000_000_000).toFixed(1)} GB`;
                const width = monthlyMax > 0 ? (item.bytes / monthlyMax) * 100 : 0;
                return <div className="monthly-traffic-row" key={item.startDate}>
                  <time dateTime={item.startDate}>{period}</time>
                  <strong>{usage}</strong>
                  <div className="monthly-traffic-track" role="meter" aria-label={t(`${period} 流量`, `${period} traffic`)} aria-valuemin={0} aria-valuemax={monthlyMax || 1} aria-valuenow={item.bytes} aria-valuetext={usage}>
                    <span style={{ width: `${width}%`, minWidth: item.bytes > 0 ? 3 : 0 }} />
                  </div>
                </div>;
              })}
              {!traffic.monthly.length ? <p className="muted">{t("暂无月流量记录", "No monthly traffic records yet")}</p> : null}
            </div>
          </Card>
          <Card variant="filled" className="protocol-panel">
            <CardHeader title={t("协议分布", "Protocol distribution")} />
            <ProtocolDistribution data={traffic.protocol} totalBytes={traffic.protocolTotalBytes} />
          </Card>
        </div>
      </Collapse>
    </Card>
    {activity ? <ActiveConnections {...activity} /> : null}
  </div>;
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
