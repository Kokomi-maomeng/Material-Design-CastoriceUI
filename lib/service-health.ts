import type { OverviewMetrics, ServiceStatus } from "./types";

export function storageIsHealthy(metrics: OverviewMetrics, services: ServiceStatus[]) {
  return metrics.databaseWritable
    && metrics.diskTotalBytes > 0
    && metrics.diskPercent < 90
    && services.filter((service) => service.id === "hysteria2" || service.id === "singbox")
      .every((service) => service.status === "running");
}
