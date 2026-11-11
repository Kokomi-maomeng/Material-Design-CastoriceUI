import { formatBytes, formatDuration } from "../lib/format";
import { useI18n, withoutTerminalPeriod } from "../lib/i18n";
import { isProtocolService, storageIsHealthy } from "../lib/service-health";
import type { OverviewMetrics, ServiceStatus } from "../lib/types";
import { Card } from "./ui/Card";
import { Icon } from "./ui/Icon";

export function ServiceCards({ services, metrics, compact = false }: {
  services: ServiceStatus[];
  metrics: OverviewMetrics;
  compact?: boolean;
}) {
  const { language, t } = useI18n();
  const adapters = services.filter(isProtocolService);
  const runningAdapters = adapters.filter((item) => item.status === "running").length;
  const storageHealthy = storageIsHealthy(metrics);
  const storageCard = <Card variant="outlined" className={`service-card service-card--storage ${compact ? "service-card--compact" : ""}`} key="storage">
    <ServiceCardHeading name={t("存储与后端", "Storage and backend")} icon="storage" status={storageHealthy ? "running" : "stopped"} label={storageHealthy ? t("正常", "Healthy") : t("异常", "Abnormal")} />
    {!compact ? <dl>
      <div><dt>{t("根分区", "Root filesystem")}</dt><dd className={metrics.diskPercent >= 90 ? "text-danger" : undefined}>{metrics.diskTotalBytes > 0 ? `${formatBytes(metrics.diskUsedBytes)} / ${formatBytes(metrics.diskTotalBytes)} · ${metrics.diskPercent.toFixed(0)}%` : "—"}</dd></div>
      <div><dt>{t("SQLite 审计", "SQLite audit")}</dt><dd className={!metrics.databaseWritable ? "text-danger" : undefined}>{metrics.databaseWritable ? metrics.databaseBytes === null ? t("采样写入成功 · 容量诊断不可用", "Sample write succeeded · size unavailable") : t(`可写 · ${formatBytes(metrics.databaseBytes)}`, `Writable · ${formatBytes(metrics.databaseBytes)}`) : t("数据库当前不可写", "Database is not writable")}</dd></div>
      <div><dt>{t("协议适配器", "Protocol adapters")}</dt><dd>{adapters.length ? t(`${runningAdapters} / ${adapters.length} 在线`, `${runningAdapters} of ${adapters.length} online`) : t("未配置", "Not configured")}</dd></div>
    </dl> : null}
  </Card>;
  const cards = services.map((service) => {
    const healthy = service.status === "running";
    const unknown = service.status === "warning" && ["inventory_missing", "inventory_stale", "core_generation_changed", "core_state_unconfirmed", "probe_unavailable", "collector_stale", "statistics_unavailable"].includes(service.stateReason ?? "");
    const certificate = service.id === "certificate";
    const detail = language === "zh" ? service.detailZh || service.detail : service.detailEn || service.detail;
    const showDetail = detail && !(healthy && ["kernel", "hysteria2", "singbox", "nginx"].includes(service.id));
    const version = !certificate && service.version ? service.version === "unknown" ? t("无法读取", "Unavailable") : service.version : null;
    const uptime = !healthy && service.kind === "protocol" ? t("无法读取", "Unavailable")
      : service.uptime ?? (service.uptimeSeconds === undefined ? null : formatDuration(service.uptimeSeconds));
    const label = healthy ? certificate ? t("有效", "Valid") : t("运行中", "Running")
      : service.status === "stopped" ? t("已离线", "Offline") : unknown ? t("待核实", "Unconfirmed") : t("需关注", "Needs attention");
    return <Card variant="outlined" className={`service-card ${healthy ? "" : service.status === "warning" ? "service-card--warning" : "service-card--abnormal"} ${compact ? "service-card--compact" : ""}`} key={service.id}>
      <ServiceCardHeading name={language === "zh" ? service.nameZh || service.name : service.nameEn || service.name} icon={service.icon} status={service.status} label={label} />
      {!compact && showDetail ? <p className="service-card__detail">{withoutTerminalPeriod(detail)}</p> : null}
      {!compact && (version || uptime) ? <dl>
        {version ? <div><dt>{t("版本", "Version")}</dt><dd>{version}</dd></div> : null}
        {uptime ? <div><dt>{t("运行时间", "Uptime")}</dt><dd>{uptime}</dd></div> : null}
      </dl> : null}
    </Card>;
  });
  const certificateIndex = services.findIndex((service) => service.id === "certificate");
  cards.splice(certificateIndex < 0 ? cards.length : certificateIndex + 1, 0, storageCard);
  return <div className="service-card-grid">{cards}</div>;
}

function ServiceCardHeading({ name, icon, status, label }: { name: string; icon: string; status: ServiceStatus["status"]; label: string }) {
  return <div className="service-card__top">
    <span className={`service-icon service-icon--${status}`}><Icon name={icon} size={20} /></span>
    <h3>{name}</h3>
    <span className={`service-state ${status === "running" ? "is-healthy" : status === "warning" ? "is-warning" : "is-error"}`}>{label}</span>
  </div>;
}
