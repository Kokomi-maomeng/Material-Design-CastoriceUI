"use client";

import { useState } from "react";
import { useI18n } from "../../lib/i18n";

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
  mode: "loading" | "live" | "stale";
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
  const estimatedDays =
    metrics.trafficUsedBytes > 0
      ? Math.max(1, Math.round((30 * remaining) / metrics.trafficUsedBytes))
      : null;
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
        description={
          stale
            ? t(
                "当前是最后一次成功快照，后端连接已中断；这些值不是当前实时状态。",
                "This is the last successful snapshot. The backend is disconnected, so these values are not live.",
              )
            : t(
                "服务器资源来自后端实时快照；协议与网络字段按数据源实际能力展示。",
                "Server resources come from the live backend snapshot. Protocol and network fields follow each data source's real capabilities.",
              )
        }
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
              <span className="metric-label">
                {t("计费周期本机估算", "Local billing-cycle estimate")}
              </span>
              <strong>{formatDecimalBytes(metrics.trafficUsedBytes)}</strong>
              <span className="metric-support">
                {t(
                  `额度 ${formatDecimalBytes(metrics.trafficLimitBytes)} · 剩余 ${formatDecimalBytes(remaining)}`,
                  `Quota ${formatDecimalBytes(metrics.trafficLimitBytes)} · ${formatDecimalBytes(remaining)} remaining`,
                )}
              </span>
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
            label={t("月度流量使用率", "Monthly traffic usage")}
          />
          <div className="traffic-hero__footer">
            <span>
              <Icon name="calendar_month" size={18} />{" "}
              {!metrics.trafficCoverageComplete
                ? t(
                    `覆盖不完整${metrics.trafficCoverageStart ? `，从 ${new Date(metrics.trafficCoverageStart).toLocaleDateString("zh-CN")} 起` : ""}`,
                    `Incomplete coverage${metrics.trafficCoverageStart ? ` since ${new Date(metrics.trafficCoverageStart).toLocaleDateString("en")}` : ""}`,
                  )
                : estimatedDays
                ? t(
                    `按当前均值约 ${estimatedDays} 天`,
                    `About ${estimatedDays} days at the current average`,
                  )
                : t("正在建立用量基线", "Establishing a usage baseline")}
            </span>
            <Chip staticChip tone={metrics.trafficCoverageComplete ? "warning" : "danger"}>
              {metrics.trafficCoverageComplete
                ? t(`已用 ${usage.toFixed(0)}%`, `${usage.toFixed(0)}% used`)
                : t("估算不完整", "Incomplete estimate")}
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
          trend={
            metrics.cpuPercent < 80 ? t("稳定", "Stable") : t("繁忙", "Busy")
          }
        />
        <MetricCard
          icon="memory_alt"
          label={t("内存", "Memory")}
          value={`${metrics.memoryPercent.toFixed(0)}%`}
          detail={`${formatBytes(metrics.memoryUsedBytes)} / ${formatBytes(metrics.memoryTotalBytes)}`}
          trend={
            metrics.memoryPercent < 85 ? t("正常", "Normal") : t("偏高", "High")
          }
        />
        <MetricCard
          icon="hard_drive"
          label={t("磁盘", "Disk")}
          value={`${metrics.diskPercent.toFixed(0)}%`}
          detail={`${formatBytes(metrics.diskUsedBytes)} / ${formatBytes(metrics.diskTotalBytes)}`}
          trend={
            metrics.diskPercent < 85 ? t("正常", "Normal") : t("偏高", "High")
          }
        />
      </section>

      <section className="content-grid content-grid--dashboard">
        <Card className="resource-panel" variant="outlined">
          <CardHeader
            title={t("流量使用趋势", "Traffic usage trend")}
            description={t(
              "基于主网卡真实采样，按所选时间范围汇总",
              "Aggregated from real primary-interface samples for the selected range",
            )}
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
            description={
              stale
                ? t(
                    "后端中断前的最后一次真实快照",
                    "Last real snapshot before the backend disconnected",
                  )
                : t(
                    "每 5 秒刷新；字段取决于协议核心实际输出",
                    "Refreshed every five seconds; fields depend on real core output",
                  )
            }
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
      </section>

      <section className="content-grid content-grid--dashboard-bottom">
        <Card variant="outlined">
          <CardHeader
            title={t("服务健康度", "Service health")}
            description={t(
              "核心组件与证书的真实状态",
              "Live status of core components and certificates",
            )}
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
                    {language === "zh"
                      ? service.detailZh || service.detail
                      : service.detailEn || service.detail}
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

        <Card variant="filled" className="quality-card">
          <CardHeader
            title={t("网络质量", "Network quality")}
            description={t(
              "探测结果最多缓存 5 分钟；不是 5 秒实时探测",
              "Probe results may be cached for five minutes; they are not five-second live tests",
            )}
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
  trend: string;
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
      <Chip staticChip>{trend}</Chip>
    </Card>
  );
}
