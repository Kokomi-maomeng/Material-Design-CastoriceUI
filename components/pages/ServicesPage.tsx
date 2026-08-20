"use client";

import type { OverviewMetrics, ServiceStatus } from "../../lib/types";
import { formatBytes, formatDuration } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { Progress } from "../ui/Progress";

export function ServicesPage({
  services,
  metrics,
  onRefresh,
}: {
  services: ServiceStatus[];
  metrics: OverviewMetrics;
  onRefresh: () => void;
}) {
  const { language, t } = useI18n();
  const running = services.filter(
    (service) => service.status === "running",
  ).length;
  const unhealthy = services.length - running;
  const adapterServices = services.filter((item) => item.id === "hysteria2" || item.id === "anytls");
  const runningAdapters = adapterServices.filter((item) => item.status === "running").length;
  return (
    <div className="page-content page-enter">
      <PageHeader
        eyebrow={t("运行状态", "Runtime status")}
        title={t("服务状态", "Services")}
        actions={
          <Button variant="tonal" icon="refresh" onClick={onRefresh}>
            {t("重新检查", "Check again")}
          </Button>
        }
      />
      <div
        className={`status-banner ${unhealthy ? "status-banner--warning" : "status-banner--success"}`}
      >
        <span>
          <Icon
            name={unhealthy ? "warning" : "check_circle"}
            size={30}
            filled
          />
        </span>
        <div>
          <strong>
            {unhealthy
              ? t("部分组件需要关注", "Some components need attention")
              : t("系统运行正常", "System is healthy")}
          </strong>
          <p>
            {t(
              `${services.length} 个受监控组件中，${running} 个正常运行，${unhealthy} 个需要关注。`,
              `${running} of ${services.length} monitored components are running; ${unhealthy} need attention.`,
            )}
          </p>
        </div>
        <Chip staticChip tone={unhealthy ? "warning" : "success"}>
          {t("实时检查", "Live check")}
        </Chip>
      </div>
      <section className="service-card-grid">
        {services.map((service) => (
          <Card variant="outlined" className="service-card" key={service.id}>
            <div className="service-card__top">
              <span className={`service-icon service-icon--${service.status}`}>
                <Icon name={service.icon} size={25} />
              </span>
              <Chip
                staticChip
                tone={
                  service.status === "running"
                    ? "success"
                    : service.status === "warning"
                      ? "warning"
                      : "danger"
                }
              >
                {service.status === "running"
                  ? t("运行中", "Running")
                  : service.status === "warning"
                    ? t("需关注", "Attention")
                    : t("已停止", "Stopped")}
              </Chip>
            </div>
            <div className="service-card__body">
              <h3>
                {language === "zh"
                  ? service.nameZh || service.name
                  : service.nameEn || service.name}
              </h3>
              <p>
                {language === "zh"
                  ? service.detailZh || service.detail
                  : service.detailEn || service.detail}
              </p>
            </div>
            <dl>
              <div>
                <dt>{t("版本", "Version")}</dt>
                <dd>{service.version}</dd>
              </div>
              {service.uptime !== undefined || service.uptimeSeconds !== undefined ? <div>
                <dt>{t("运行时间", "Uptime")}</dt>
                <dd>
                  {service.uptime ?? formatDuration(service.uptimeSeconds ?? 0)}
                </dd>
              </div> : null}
            </dl>
          </Card>
        ))}
      </section>
      <section className="content-grid content-grid--services-bottom">
        <Card variant="filled">
          <CardHeader
            title={t("主机信息", "Host information")}
            description={metrics.nodeName}
          />
          <div className="host-info">
            <div>
              <span>{t("系统运行时间", "System uptime")}</span>
              <b>{formatDuration(metrics.uptimeSeconds)}</b>
            </div>
            <div>
              <span>{t("系统负载", "System load")}</span>
              <b>{metrics.load.join(" / ")}</b>
            </div>
            <div>
              <span>{t("内核版本", "Kernel")}</span>
              <b>{metrics.kernel}</b>
            </div>
            <div>
              <span>{t("采集网卡", "Sampled interface")}</span>
              <b>{metrics.interface}</b>
            </div>
          </div>
        </Card>
        <Card variant="outlined">
          <CardHeader
            title={t("存储与后端", "Storage and backend")}
            description={t("实时读取", "Live readings")}
          />
          <div className="storage-list">
            <div>
              <span>
                <b>{t("根分区", "Root filesystem")}</b>
                <small>
                  {formatBytes(metrics.diskUsedBytes)} /{" "}
                  {formatBytes(metrics.diskTotalBytes)}
                </small>
              </span>
              <Progress value={metrics.diskPercent} />
            </div>
            <div>
              <span>
                <b>{t("SQLite 审计", "SQLite audit")}</b>
                <small>
                  {metrics.databaseWritable
                    ? t(`采样写入成功 · ${formatBytes(metrics.databaseBytes)}`, `Sample write succeeded · ${formatBytes(metrics.databaseBytes)}`)
                    : t("数据库当前不可写", "Database is not writable")}
                </small>
              </span>
              <Progress value={metrics.databaseWritable ? 100 : 0} tone={metrics.databaseWritable ? "success" : "danger"} />
            </div>
            <div>
              <span>
                <b>{t("协议适配器", "Protocol adapters")}</b>
                <small>
                  {t(
                    `${runningAdapters} / ${adapterServices.length} 个数据源在线`,
                    `${runningAdapters} of ${adapterServices.length} data sources online`,
                  )}
                </small>
              </span>
              <Progress
                value={
                  adapterServices.length ? (runningAdapters / adapterServices.length) * 100 : 0
                }
                tone="success"
              />
            </div>
          </div>
        </Card>
      </section>
    </div>
  );
}
