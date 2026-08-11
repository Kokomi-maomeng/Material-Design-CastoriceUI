export type Protocol =
  | "Hysteria2"
  | "AnyTLS"
  | "VLESS"
  | "VLESS · XTLS Vision"
  | "VLESS · Reality"
  | "VLESS · XTLS Vision · Reality"
  | "SOCKS5"
  | "Shadowsocks"
  | "VMess"
  | "Trojan"
  | "TUIC";

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
  uploadBps: number | null;
  downloadBps: number | null;
  connectedAt: string | null;
  uploadedBytes?: number;
  downloadedBytes?: number;
  destination?: string | null;
  details: ConnectionDetail[];
}

export interface ConnectionDetail {
  id: string;
  destination?: string | null;
  uploadBps: number | null;
  downloadBps: number | null;
  uploadedBytes?: number;
  downloadedBytes?: number;
  connectedAt: string | null;
}

export interface TrafficPoint {
  label: string;
  upload: number;
  download: number;
}

export type TrafficRange = "1h" | "6h" | "24h" | "3day" | "7day";

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
  order?: number;
}

export interface ServiceStatus {
  id: string;
  name: string;
  nameZh?: string;
  nameEn?: string;
  detail: string;
  detailZh?: string;
  detailEn?: string;
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
  | "vless"
  | "socks5"
  | "shadowsocks"
  | "vmess"
  | "trojan"
  | "tuic"
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
  status: "ready" | "pending" | "preview" | "error";
  summary: string;
  summaryZh?: string;
  summaryEn?: string;
}

export interface OverviewMetrics {
  nodeName: string;
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
  mode: "loading" | "live" | "stale";
  generatedAt: string;
  overview: OverviewMetrics;
  accounts: Account[];
  connections: Connection[];
  traffic: {
    ranges: Record<TrafficRange, TrafficPoint[]>;
    hourly: TrafficPoint[];
    daily: TrafficPoint[];
    protocol: TrafficBreakdown[];
    account: TrafficBreakdown[];
  };
  subscriptions: Subscription[];
  networkTargets: NetworkTarget[];
  services: ServiceStatus[];
  alerts: AlertItem[];
  integrations: IntegrationStatus[];
  uiSettings: UiSettings;
}

export interface UiSettings {
  showSetup: boolean;
  visiblePanels: PageId[];
}

export interface LoginAppearance {
  type: "default" | "url" | "server";
  url: string;
}

export interface BootstrapState {
  setupRequired: boolean;
  bootstrapAvailable: boolean;
  appearance: LoginAppearance;
}

export interface SessionState {
  username: string;
  csrfToken: string;
  expiresAt: number;
  setupComplete: boolean;
}

export interface AlertItem {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  titleZh?: string;
  titleEn?: string;
  description: string;
  descriptionZh?: string;
  descriptionEn?: string;
  time: string;
  timeZh?: string;
  timeEn?: string;
  acknowledged: boolean;
  episodeId: string;
  startedAt: string;
  source: string;
  sourceZh?: string;
  sourceEn?: string;
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

export interface AuditPageResponse {
  items: AuditEvent[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
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
  | "setup"
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
  labelZh: string;
  labelEn: string;
  icon: string;
}
