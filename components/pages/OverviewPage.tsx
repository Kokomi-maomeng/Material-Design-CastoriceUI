"use client";

import { useState } from "react";
import { useI18n, withoutTerminalPeriod } from "../../lib/i18n";

import { formatBytes, formatDecimalBytes, percent } from "../../lib/format";
import type {
  Connection,
  DashboardPayload,
  NetworkTarget,
  OverviewMetrics,
  ServiceStatus,
  TrafficRange,
} from "../../lib/types";
import { TrafficChart } from "../charts/TrafficChart";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { Progress } from "../ui/Progress";

export function OverviewPage({
  mode,
  metrics,
  connections,
  services,
  networkTargets,
  traffic,
  onEditQuota,
  onRefresh,
  onViewServices,
}: {
  mode: "loading" | "live" | "stale" | "error";
  metrics: OverviewMetrics;
  connections: Connection[];
  services: ServiceStatus[];
  networkTargets: NetworkTarget[];
  traffic: DashboardPayload["traffic"];
  onEditQuota: () => void;
  onRefresh: () => void;
  onViewServices: () => void;
}) {
  const { language, t } = useI18n();
  const [trafficRange, setTrafficRange] = useState<TrafficRange>("24h");
  const stale = mode === "stale";
  const usage = percent(metrics.trafficUsedBytes, metrics.trafficLimitBytes);
  const connectionRatesAvailable =
    connections.length > 0 &&
    connections.every(
      (item) => item.downloadBps !== null && item.uploadBps !== null,
    );
  const totalDown = connectionRatesAvailable
    ? connections.reduce((sum, item) => sum + (item.downloadBps ?? 0), 0)
    : metrics.downloadBps;
  const totalUp = connectionRatesAvailable
    ? connections.reduce((sum, item) => sum + (item.uploadBps ?? 0), 0)
    : metrics.uploadBps;
  const onlineAccounts = new Set(connections.map((item) => item.account)).size;
  const remaining = Math.max(
    0,
    metrics.trafficLimitBytes - metrics.trafficUsedBytes,
  );
  const quota = metrics.trafficQuota;
  const nextResetInBillingZone = quota?.nextReset ? new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en", { timeZone: quota.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(quota.nextReset)) : "";
  const quotaCycleText = quota?.autoReset && quota.nextReset
    ? t(
        `每 ${quota.periodCount} ${quota.periodUnit === "day" ? "日" : quota.periodUnit === "week" ? "周" : quota.periodUnit === "month" ? "月" : "年"}重置 · 下次 ${nextResetInBillingZone}（${quota.timezone}）`,
        `Resets every ${quota.periodCount} ${quota.periodUnit}(s) · next ${nextResetInBillingZone} (${quota.timezone})`,
      )
    : "";
  const reachableTargets = networkTargets.filter(
    (target) => target.status !== "down",
  ).length;
  const averageLatency = networkTargets.length
    ? networkTargets.reduce((sum, target) => sum + target.latency, 0) /
      networkTargets.length
    : 0;
  const averageLoss = networkTargets.length
    ? networkTargets.reduce((sum, target) => sum + target.loss, 0) /
      networkTargets.length
    : 0;
  const networkGrade =
    networkTargets.length === 0
      ? t("暂无数据", "No data")
      : averageLoss >= 5 || averageLatency >= 150
        ? t("较差", "Poor")
        : averageLoss >= 1 || averageLatency >= 80
          ? t("一般", "Fair")
          : t("优秀", "Excellent");

  return (
    <div className="page-content page-enter">
      <PageHeader
        title={metrics.nodeName}
        description={stale ? t(
          "当前是最后一次成功快照，后端连接已中断；这些值不是当前实时状态。",
          "This is the last successful snapshot. The backend is disconnected, so these values are not live.",
        ) : undefined}
        actions={
          <Button variant="tonal" icon="refresh" onClick={onRefresh}>
            {t("刷新数据", "Refresh")}
          </Button>
        }
      />

      <section
        className="overview-hero-grid"
        aria-label={t("关键运行指标", "Key runtime metrics")}
      >
        <Card className="traffic-hero" variant="elevated">
          <div className="traffic-hero__top">
            <div>
              <span className="metric-label">{t("流量用量", "Traffic usage")}</span>
              <strong>{formatDecimalBytes(metrics.trafficUsedBytes)}</strong>
              <span className="metric-support">
                {t(
                  `额度 ${formatDecimalBytes(metrics.trafficLimitBytes)} · 剩余 ${formatDecimalBytes(remaining)}`,
                  `Quota ${formatDecimalBytes(metrics.trafficLimitBytes)} · ${formatDecimalBytes(remaining)} remaining`,
                )}
              </span>
              {quotaCycleText ? <span className="metric-support">{quotaCycleText}</span> : null}
            </div>
            <Button
              variant="text"
              icon="edit"
              aria-label={t("修改总流量额度", "Edit traffic quota")}
              onClick={onEditQuota}
            />
          </div>
          <Progress
            value={usage}
            tone={usage >= 90 ? "danger" : usage >= 75 ? "warning" : "primary"}
            label={t("当前周期流量使用率", "Current-cycle traffic usage")}
          />
          <div className="traffic-hero__footer">
            <span>
              <Icon name="data_usage" size={18} />
              {t(`剩余 ${formatDecimalBytes(remaining)}`, `${formatDecimalBytes(remaining)} remaining`)}
            </span>
            <Chip staticChip tone={usage >= 90 ? "danger" : usage >= 75 ? "warning" : "default"}>
              {t(`已用 ${usage.toFixed(0)}%`, `${usage.toFixed(0)}% used`)}
            </Chip>
          </div>
        </Card>

        <MetricCard
          icon="memory"
          label="CPU"
          value={`${metrics.cpuPercent.toFixed(0)}%`}
          detail={t(
            `${metrics.cpuCores} 核 · 负载 ${metrics.load[0] ?? 0}`,
            `${metrics.cpuCores} cores · load ${metrics.load[0] ?? 0}`,
          )}
          trend={metrics.cpuPercent >= 80 ? t("繁忙", "Busy") : undefined}
        />
        <MetricCard
          icon="memory_alt"
          label={t("内存", "Memory")}
          value={`${metrics.memoryPercent.toFixed(0)}%`}
          detail={`${formatBytes(metrics.memoryUsedBytes)} / ${formatBytes(metrics.memoryTotalBytes)}`}
          trend={metrics.memoryPercent >= 85 ? t("偏高", "High") : undefined}
        />
        <MetricCard
          icon="hard_drive"
          label={t("存储", "Storage")}
          value={`${metrics.diskPercent.toFixed(0)}%`}
          detail={`${formatBytes(metrics.diskUsedBytes)} / ${formatBytes(metrics.diskTotalBytes)}`}
          trend={metrics.diskPercent >= 85 ? t("偏高", "High") : undefined}
        />
      </section>

      <section className="content-grid content-grid--dashboard">
        <Card className="resource-panel" variant="outlined">
          <CardHeader
            title={t("流量使用趋势", "Traffic usage trend")}
            action={
              <RangeControl value={trafficRange} onChange={setTrafficRange} />
            }
          />
          <div className="legend-inline legend-inline--chart">
            <span className="dot dot--primary" />
            {t("下载", "Download")}
            <span className="dot dot--secondary" />
            {t("上传", "Upload")}
          </div>
          <TrafficChart
            data={(traffic.ranges?.[trafficRange] ?? []).map((item) => ({
              ...item,
              upload: item.upload / 1_000_000_000,
              download: item.download / 1_000_000_000,
            }))}
          />
        </Card>

        <Card className="live-summary" variant="filled">
          <CardHeader
            title={t("协议连接快照", "Protocol connection snapshot")}
            description={stale ? t(
              "后端中断前的最后一次真实快照",
              "Last real snapshot before the backend disconnected",
            ) : undefined}
            action={
              <Chip
                staticChip
                tone={stale ? "warning" : "success"}
                icon={stale ? "cloud_off" : "schedule"}
              >
                {stale
                  ? t("已停止更新", "Stale")
                  : t("实时快照", "Live snapshot")}
              </Chip>
            }
          />
          <div className="live-speed">
            <div>
              <span>
                <Icon name="download" size={18} />
                {connectionRatesAvailable
                  ? t("连接下载", "Connection download")
                  : t(
                      `主网卡 ${metrics.interface} 下载`,
                      `${metrics.interface} download`,
                    )}
              </span>
              <strong>
                {formatBytes(totalDown)}
                <small>/s</small>
              </strong>
            </div>
            <div>
              <span>
                <Icon name="upload" size={18} />
                {connectionRatesAvailable
                  ? t("连接上传", "Connection upload")
                  : t(
                      `主网卡 ${metrics.interface} 上传`,
                      `${metrics.interface} upload`,
                    )}
              </span>
              <strong>
                {formatBytes(totalUp)}
                <small>/s</small>
              </strong>
            </div>
          </div>
          <div className="live-meta">
            <span>
              <b>{connections.length}</b> {t("活动连接组", "active groups")}
            </span>
            <span>
              <b>{onlineAccounts}</b> {t("活跃账号", "active accounts")}
            </span>
            <span>
              <b>
                {connections.reduce((sum, item) => sum + item.connections, 0)}
              </b>{" "}
              {t("并发连接", "concurrent connections")}
            </span>
          </div>
        </Card>
        <Card variant="filled" className="quality-card">
          <CardHeader
            title={t("网络质量", "Network quality")}
          />
          <div className="quality-summary">
            <span>
              <Icon name="verified" size={26} />
            </span>
            <div>
              <small>{t("当前质量等级", "Current quality")}</small>
              <strong>{networkGrade}</strong>
              <em>
                {t(
                  `${reachableTargets} / ${networkTargets.length} 个目标可达`,
                  `${reachableTargets} of ${networkTargets.length} targets reachable`,
                )}
              </em>
            </div>
          </div>
          <div className="quality-bars">
            <div>
              <span>{t("平均延迟", "Average latency")}</span>
              <b>
                {networkTargets.length
                  ? `${averageLatency.toFixed(1)} ms`
                  : t("等待探测", "Waiting")}
              </b>
              <Progress
                value={
                  networkTargets.length
                    ? Math.max(0, 100 - averageLatency / 2)
                    : 0
                }
                tone={
                  networkTargets.length && averageLatency < 80
                    ? "success"
                    : "warning"
                }
              />
            </div>
            <div>
              <span>{t("平均丢包", "Average loss")}</span>
              <b>
                {networkTargets.length
                  ? `${averageLoss.toFixed(1)}%`
                  : t("等待探测", "Waiting")}
              </b>
              <Progress
                value={
                  networkTargets.length
                    ? Math.max(0, 100 - averageLoss * 10)
                    : 0
                }
                tone={
                  networkTargets.length && averageLoss < 1
                    ? "success"
                    : "warning"
                }
              />
            </div>
          </div>
        </Card>
      </section>

      <section className="content-grid content-grid--dashboard-bottom">
        <Card variant="outlined">
          <CardHeader
            title={t("服务健康度", "Service health")}
            action={
              <Button
                variant="text"
                compact
                trailingIcon="arrow_forward"
                onClick={onViewServices}
              >
                {t("查看全部", "View all")}
              </Button>
            }
          />
          <div className="service-compact-list">
            {services.slice(0, 4).map((service) => (
              <div className="service-compact" key={service.id}>
                <span
                  className={`service-icon service-icon--${service.status}`}
                >
                  <Icon name={service.icon} />
                </span>
                <div>
                  <strong>
                    {language === "zh"
                      ? service.nameZh || service.name
                      : service.nameEn || service.name}
                  </strong>
                  <span>
                    {withoutTerminalPeriod(
                      language === "zh"
                        ? service.detailZh || service.detail
                        : service.detailEn || service.detail,
                    )}
                  </span>
                </div>
                <Chip
                  staticChip
                  tone={service.status === "running" ? "success" : "warning"}
                >
                  {service.status === "running"
                    ? t("运行中", "Running")
                    : t("需关注", "Attention")}
                </Chip>
              </div>
            ))}
          </div>
        </Card>
      </section>
    </div>
  );
}

function RangeControl({
  value,
  onChange,
}: {
  value: TrafficRange;
  onChange: (value: TrafficRange) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="segmented-control traffic-range-control">
      {(["1h", "6h", "24h", "3day", "7day"] as const).map((item) => (
        <button
          key={item}
          className={value === item ? "is-selected" : ""}
          onClick={() => onChange(item)}
        >
          {item === "3day"
            ? t("3天", "3 days")
            : item === "7day"
              ? t("7天", "7 days")
              : item}
        </button>
      ))}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
  trend,
}: {
  icon: string;
  label: string;
  value: string;
  detail: string;
  trend?: string;
}) {
  return (
    <Card className="metric-card" variant="filled">
      <div className="metric-card__icon">
        <Icon name={icon} size={24} />
      </div>
      <div className="metric-card__body">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      {trend ? <Chip staticChip tone="warning">{trend}</Chip> : null}
    </Card>
  );
}
