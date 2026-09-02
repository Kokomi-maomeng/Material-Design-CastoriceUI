import { formatBytes, formatDuration } from "../lib/format";
import { useI18n, withoutTerminalPeriod } from "../lib/i18n";
import { storageIsHealthy } from "../lib/service-health";
import type { OverviewMetrics, ServiceStatus } from "../lib/types";
import { Card } from "./ui/Card";
import { Icon } from "./ui/Icon";
import { Progress } from "./ui/Progress";

export function ServiceCards({ services, metrics, compact = false }: {
  services: ServiceStatus[];
  metrics: OverviewMetrics;
  compact?: boolean;
}) {
  const { language, t } = useI18n();
  const adapters = services.filter((item) => item.id === "hysteria2" || item.id === "singbox");
  const runningAdapters = adapters.filter((item) => item.status === "running").length;
  const storageHealthy = storageIsHealthy(metrics, services);
  const storageCard = <Card variant="outlined" className={`service-card service-card--storage ${compact ? "service-card--compact" : ""}`} key="storage">
    <div className="service-card__top">
      <span className={`service-icon service-icon--${storageHealthy ? "running" : "stopped"}`}><Icon name="storage" size={25} /></span>
      <span className={`service-state ${storageHealthy ? "is-healthy" : "is-error"}`}><Icon name={storageHealthy ? "check_circle" : "error"} size={18} />{storageHealthy ? t("正常", "Healthy") : t("异常", "Abnormal")}</span>
    </div>
    <div className="service-card__body"><h3>{t("存储与后端", "Storage and backend")}</h3></div>
    {!compact ? <div className="storage-list">
      <div><span><b>{t("根分区", "Root filesystem")}</b><small>{formatBytes(metrics.diskUsedBytes)} / {formatBytes(metrics.diskTotalBytes)}</small></span><Progress value={metrics.diskPercent} tone={metrics.diskPercent >= 90 ? "danger" : "primary"} /></div>
      <div><span><b>{t("SQLite 审计", "SQLite audit")}</b><small>{metrics.databaseWritable ? t(`采样写入成功 · ${formatBytes(metrics.databaseBytes)}`, `Sample write succeeded · ${formatBytes(metrics.databaseBytes)}`) : t("数据库当前不可写", "Database is not writable")}</small></span><Progress value={metrics.databaseWritable ? 100 : 0} tone={metrics.databaseWritable ? "success" : "danger"} /></div>
      <div><span><b>{t("协议适配器", "Protocol adapters")}</b><small>{adapters.length ? t(`${runningAdapters} / ${adapters.length} 个数据源在线`, `${runningAdapters} of ${adapters.length} data sources online`) : t("未配置可选协议适配器", "No optional protocol adapters configured")}</small></span><Progress value={adapters.length ? (runningAdapters / adapters.length) * 100 : 0} tone={!adapters.length ? "primary" : runningAdapters < adapters.length ? "warning" : "success"} /></div>
    </div> : null}
  </Card>;
  const cards = services.map((service) => {
    const healthy = service.status === "running";
    return <Card variant="outlined" className={`service-card ${compact ? "service-card--compact" : ""}`} key={service.id}>
      <div className="service-card__top">
        <span className={`service-icon service-icon--${healthy ? "running" : "stopped"}`}><Icon name={service.icon} size={25} /></span>
        <span className={`service-state ${healthy ? "is-healthy" : "is-error"}`}>{healthy ? t("运行中", "Running") : t("异常", "Abnormal")}</span>
      </div>
      <div className="service-card__body">
        <h3>{language === "zh" ? service.nameZh || service.name : service.nameEn || service.name}</h3>
        {!compact ? <p>{withoutTerminalPeriod(language === "zh" ? service.detailZh || service.detail : service.detailEn || service.detail)}</p> : null}
      </div>
      {!compact ? <dl>
        <div><dt>{t("版本", "Version")}</dt><dd>{service.version}</dd></div>
        {service.uptime !== undefined || service.uptimeSeconds !== undefined ? <div><dt>{t("运行时间", "Uptime")}</dt><dd>{service.uptime ?? formatDuration(service.uptimeSeconds ?? 0)}</dd></div> : null}
      </dl> : null}
    </Card>;
  });
  const certificateIndex = services.findIndex((service) => service.id === "certificate");
  cards.splice(certificateIndex < 0 ? cards.length : certificateIndex + 1, 0, storageCard);
  return <div className="service-card-grid">{cards}</div>;
}
