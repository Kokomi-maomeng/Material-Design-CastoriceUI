export type Protocol = "Hysteria2" | "AnyTLS" | "VLESS" | "TUIC";

export type AccountStatus = "active" | "disabled" | "expiring";

export interface Account {
  id: string;
  name: string;
  email: string;
  status: AccountStatus;
  protocols: Protocol[];
  usedBytes: number;
  quotaBytes: number;
  expiresAt: string;
  note: string;
  onlineDevices: number;
}

export interface Connection {
  id: string;
  protocol: Protocol;
  account: string;
  sourceIp: string;
  ipVersion: 4 | 6 | null;
  connections: number;
  uploadBps: number;
  downloadBps: number;
  connectedAt: string;
  uploadedBytes?: number;
  downloadedBytes?: number;
}

export interface TrafficPoint {
  label: string;
  upload: number;
  download: number;
}

export interface NetworkTarget {
  id: string;
  name: string;
  provider: string;
  address: string;
  ipVersion: 4 | 6;
  latency: number;
  jitter: number;
  loss: number;
  status: "healthy" | "degraded" | "down";
  history: number[];
}

export interface ServiceStatus {
  id: string;
  name: string;
  detail: string;
  status: "running" | "warning" | "stopped";
  version: string;
  uptime?: string;
  uptimeSeconds?: number;
  icon: string;
}

export type IntegrationId =
  | "system"
  | "hysteria2"
  | "anytls"
  | "connections"
  | "traffic"
  | "subscriptions"
  | "network"
  | "alerts"
  | "audit";

export interface IntegrationStatus {
  id: IntegrationId;
  enabled: boolean;
  configured: boolean;
  status: "ready" | "pending" | "error";
  summary: string;
}

export interface OverviewMetrics {
  nodeName: string;
  nodeRegion: string;
  cpuPercent: number;
  cpuCores: number;
  memoryPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskPercent: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  load: number[];
  uptimeSeconds: number;
  trafficUsedBytes: number;
  trafficLimitBytes: number;
  downloadBps: number;
  uploadBps: number;
  interface: string;
  kernel: string;
}

export interface TrafficBreakdown {
  name: string;
  value: number;
  color?: string;
}

export interface DashboardPayload {
  mode: "live" | "preview";
  generatedAt: string;
  overview: OverviewMetrics;
  accounts: Account[];
  connections: Connection[];
  traffic: {
    hourly: TrafficPoint[];
    daily: TrafficPoint[];
    protocol: TrafficBreakdown[];
    account: TrafficBreakdown[];
  };
  subscriptions: Subscription[];
  networkTargets: NetworkTarget[];
  services: ServiceStatus[];
  alerts: AlertItem[];
  auditEvents: AuditEvent[];
  integrations: IntegrationStatus[];
  resourceHistory: Array<{ label: string; cpu: number; memory: number }>;
}

export interface AlertItem {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  description: string;
  time: string;
  acknowledged: boolean;
  source: string;
}

export interface AuditEvent {
  id: string;
  action: string;
  category: "认证" | "账号" | "配置" | "系统";
  actor: string;
  ip: string;
  time: string;
  result: "成功" | "失败";
  detail: string;
}

export interface Subscription {
  id: string;
  account: string;
  tokenHint: string;
  protocols: Protocol[];
  updatedAt: string;
  lastFetchedAt: string;
  enabled: boolean;
  url?: string;
}

export type PageId =
  | "overview"
  | "accounts"
  | "connections"
  | "traffic"
  | "subscriptions"
  | "network"
  | "services"
  | "alerts"
  | "audit";

export interface NavigationItem {
  id: PageId;
  label: string;
  icon: string;
  badge?: number;
}
