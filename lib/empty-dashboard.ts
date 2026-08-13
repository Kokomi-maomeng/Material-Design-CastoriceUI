import type { DashboardPayload } from "./types";

const emptyRanges = { "1h": [], "6h": [], "24h": [], "3day": [], "7day": [] };

export const emptyDashboard: DashboardPayload = {
  mode: "loading",
  generatedAt: new Date(0).toISOString(),
  overview: {
    nodeName: "VPS node", cpuPercent: 0, cpuCores: 0, memoryPercent: 0,
    memoryUsedBytes: 0, memoryTotalBytes: 0, diskPercent: 0, diskUsedBytes: 0,
    diskTotalBytes: 0, load: [0, 0, 0], uptimeSeconds: 0, trafficUsedBytes: 0,
    trafficLimitBytes: 0, trafficCycleStart: new Date(0).toISOString(), trafficCoverageStart: null,
    trafficCoverageComplete: false, trafficBaselineBytes: 0, trafficCountMode: "sum", trafficQuotaUnit: "GB",
    downloadBps: 0, uploadBps: 0, interface: "--", kernel: "--", databaseBytes: 0, databaseWritable: false,
  },
  accounts: [], connections: [],
  traffic: { ranges: emptyRanges, hourly: [], daily: [], protocol: [], account: [] },
  subscriptions: [], networkTargets: [], services: [], alerts: [], integrations: [],
  uiSettings: { showSetup: true, visiblePanels: [], panelTitle: "CastoriceUI", idleTimeoutMinutes: 15 },
};
