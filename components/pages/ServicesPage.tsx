"use client";

import type { OverviewMetrics, ServiceStatus } from "../../lib/types";
import { formatBytes, formatDuration } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { storageIsHealthy } from "../../lib/service-health";
import { ServiceCards } from "../ServiceCards";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

export function ServicesPage({ services, metrics, onRefresh }: {
  services: ServiceStatus[];
  metrics: OverviewMetrics;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const allHealthy = services.length > 0 && services.every((service) => service.status === "running") && storageIsHealthy(metrics, services);
  return <div className="page-content page-enter services-page">
      <PageHeader
        eyebrow={t("运行状态", "Runtime status")}
        title={t("服务状态", "Services")}
        actions={<div className="service-header-actions">
          <div className={`service-health-card ${allHealthy ? "is-healthy" : "is-warning"}`} role="status">
            <Icon name={allHealthy ? "check_circle" : "warning"} size={20} filled />
            <strong>{allHealthy
              ? t("系统运行正常", "System is healthy")
              : services.length
                ? t("部分组件需要关注", "Some components need attention")
                : t("暂无服务状态", "No service status")}</strong>
          </div>
          <Button variant="tonal" icon="refresh" onClick={onRefresh}>
            {t("刷新", "Refresh")}
          </Button>
        </div>}
      />
        <Card variant="filled" className="host-info-card">
          <CardHeader
            title={t("主机信息", "Host information")}
            description={metrics.nodeName}
          />
          <div className="host-info">
            <div>
              <span>{t("内存用量", "Memory usage")}</span>
              <b>{formatBytes(metrics.memoryUsedBytes)} / {formatBytes(metrics.memoryTotalBytes)} · {metrics.memoryPercent.toFixed(1)}%</b>
            </div>
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
    <ServiceCards services={services} metrics={metrics} />
  </div>;
}
