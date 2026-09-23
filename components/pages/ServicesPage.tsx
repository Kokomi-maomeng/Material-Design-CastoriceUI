"use client";

import { useState } from "react";
import type { OverviewMetrics, ResourceSample, ServiceStatus } from "../../lib/types";
import { formatBytes, formatDuration } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { storageIsHealthy } from "../../lib/service-health";
import { ServiceCards } from "../ServiceCards";
import { ResourceChart } from "../charts/ResourceChart";
import { Button } from "../ui/Button";
import { Card, CardHeader } from "../ui/Card";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

export function ServicesPage({ services, metrics, resourceHistory, onRefresh }: {
  services: ServiceStatus[];
  metrics: OverviewMetrics;
  resourceHistory?: Record<"1h" | "6h" | "24h", ResourceSample[]>;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const [range, setRange] = useState<"1h" | "6h" | "24h">("1h");
  const allHealthy = services.length > 0 && services.every((service) => service.status === "running") && storageIsHealthy(metrics);
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
              <span>{t("CPU 用量", "CPU usage")}</span>
              <b>{metrics.cpuPercent.toFixed(1)}% · {metrics.cpuCores} {t("核", "cores")}</b>
            </div>
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
    <Card variant="outlined" className="resource-history-panel">
      <CardHeader title={t("CPU 与内存记录", "CPU and memory history")} description={t("每分钟采样；曲线按所选范围聚合", "Sampled every minute; the selected range uses aggregated values")} action={<div className="segmented-control resource-range-control" aria-label={t("资源记录时间范围", "Resource history range")}>{(["1h", "6h", "24h"] as const).map((item) => <button type="button" key={item} className={range === item ? "is-selected" : ""} aria-pressed={range === item} onClick={() => setRange(item)}>{item}</button>)}</div>} />
      <div className="legend-inline resource-chart-legend"><span className="dot dot--primary" />CPU<span className="dot dot--secondary" />{t("内存", "Memory")}</div>
      <ResourceChart data={resourceHistory?.[range] ?? []} />
    </Card>
  </div>;
}
