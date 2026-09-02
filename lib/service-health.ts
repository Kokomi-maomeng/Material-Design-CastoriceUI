import type { OverviewMetrics, ServiceStatus } from "./types";

export function isProtocolService(service: ServiceStatus) {
  return service.kind === "protocol" || (!service.kind && ["hysteria2", "singbox"].includes(service.id));
}

export function storageIsHealthy(metrics: OverviewMetrics, services: ServiceStatus[]) {
  return metrics.databaseWritable
    && metrics.diskTotalBytes > 0
    && metrics.diskPercent < 90
    && services.filter(isProtocolService)
      .every((service) => service.status === "running");
}
