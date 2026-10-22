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

export type AccountStatus = "registered" | "disabled" | "expiring" | "expired" | "unknown";

export interface Account {
  id: string;
  name: string;
  email: string;
  status: AccountStatus;
  configuredStatus: "active" | "disabled" | "unknown";
  expiryStatus: "valid" | "expiring" | "expired" | "notConfigured" | "unknown";
  coreEvidence: "observed" | "notObserved" | "unavailable" | "unknown";
  protocols: Protocol[];
  usedBytes: number;
  usageSource: "protocolCounter" | "unmapped";
  quotaBytes: number;
  expiresAt: string;
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
  ratesPartial?: boolean;
  rateCoverage?: { known: number; total: number };
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
  intervalSeconds?: number;
  gapBefore?: boolean;
  label: string;
  capturedAt?: string;
  upload: number;
  download: number;
}

export interface MonthlyTrafficUsage {
  startDate: string;
  endDate: string;
  bytes: number;
  coverage?: TrafficCoverage;
}

export interface TrafficCoverage { complete: boolean; gapCount: number; resetCount: number; firstSampleAt: number | null; lastSampleAt: number | null; }

export type TrafficRange = "1h" | "6h" | "24h" | "3day" | "7day";

export interface NetworkTarget {
  id: string;
  name: string;
  provider: string;
  address: string;
  ipVersion: 0 | 4 | 6;
  resolvedIpVersion?: 4 | 6;
  latency: number | null;
  jitter: number | null;
  loss: number | null;
  status: "healthy" | "degraded" | "down" | "unavailable";
  measurementStatus?: "measured" | "unavailable";
  probeReason?: string;
  observedAt?: string;
  history: number[];
  complete?: boolean;
  sent?: number | null;
  received?: number | null;
  latencyMs?: number;
  lossPercent?: number;
  tcpPort?: number;
  dnsPort?: number;
  dnsName?: string;
  effectivePolicy?: { latencyMs: number; lossPercent: number; windowSeconds: number; minimumPackets: number };
  thresholdOverrides?: { latencyMs?: number; lossPercent?: number };
  alertConfirmed?: boolean;
  qualityWindow?: { sent: number; received: number; loss: number | null; ready: boolean; confirmation: string };
  layers?: Record<string, { configured: boolean; status: string; observedAt?: string; durationMs?: number }>;
  timeHistory?: NetworkHistorySample[];
  order?: number;
}

export interface NetworkHistorySample { capturedAt: number; latency: number | null; loss: number | null; complete: boolean; status: string; hasGaps?: boolean; samples?: number }
export interface NetworkHistoryResponse { targetId: string; hours: number; ipVersion: number; start: number; end: number; granularitySeconds: number; aggregation: "maximum"; sourceSamples: number; truncated: boolean; samples: NetworkHistorySample[] }
export interface MonitoringContext {
  networkCorrelation?: { observedAt?: string; classification?: string; affectedTargets?: string[]; ipVersions?: number[]; normalSamples?: number; rootCause?: string };
  officialStatus?: { status?: string; observedAt?: string; incidents?: { id: string; name?: string; status?: string; started_at?: string; resolved_at?: string; components?: { name?: string; status?: string }[] }[] };
  resource?: { observedAt?: string; memoryBytes?: number; memoryEventDelta?: Record<string, number>; available?: boolean }[];
}

export interface ServiceStatus {
  kind?: "protocol" | "core" | "monitor";
  id: string;
  name: string;
  nameZh?: string;
  nameEn?: string;
  detail: string;
  detailZh?: string;
  detailEn?: string;
  status: "running" | "warning" | "stopped";
  stateReason?: string;
  version: string;
  uptime?: string;
  uptimeSeconds?: number;
  icon: string;
  certificateState?: "unconfigured" | "unreadable" | "valid" | "expiring" | "expired";
  renewalEvidence?: string;
  endpointEvidence?: string;
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
  status: "ready" | "partial" | "pending" | "preview" | "error";
  sources?: { id: string; status: "ready" | "error" }[];
  summary: string;
  summaryZh?: string;
  summaryEn?: string;
  values?: Record<string, string>;
  observedAt?: string;
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
  trafficCycleStart: string;
  trafficBaselineBytes: number;
  trafficCountMode: "sum" | "max";
  trafficQuotaUnit: "GB";
  trafficQuota?: TrafficQuotaSettings;
  trafficCoverage?: TrafficCoverage;
  downloadBps: number;
  uploadBps: number;
  interface: string;
  configuredInterface?: string;
  interfaceFallback?: boolean;
  kernel: string;
  databaseBytes: number | null;
  databaseWritable: boolean;
}

export interface TrafficQuotaSettings {
  bytes: number;
  autoReset: boolean;
  periodUnit: "day" | "week" | "month" | "year";
  periodCount: number;
  resetAnchor: string;
  resetTime: string;
  timezone: string;
  cycleStart: string;
  nextReset: string | null;
}

export interface TrafficBreakdown {
  name: string;
  nameZh?: string;
  nameEn?: string;
  value: number;
  color?: string;
}

export interface DashboardPayload {
  rejectedAlertCount?: number;
  mode: "loading" | "live" | "stale" | "error";
  generatedAt: string;
  runtimeObservedAt?: string | null;
  freshness?: Record<string, { status: string; observedAt: string | null; ageSeconds: number | null; ttlSeconds: number; error: string | null; durationMs?: number | null }>;
  overview: OverviewMetrics;
  resourceHistory: Record<"1h" | "6h" | "24h", ResourceSample[]>;
  accounts: Account[];
  connections: Connection[];
  traffic: {
    totalBytes: number;
    protocolTotalBytes: number;
    accountTotalBytes: number;
    ranges: Record<TrafficRange, TrafficPoint[]>;
    hourly: TrafficPoint[];
    daily: TrafficPoint[];
    monthly: MonthlyTrafficUsage[];
    protocol: TrafficBreakdown[];
    account: TrafficBreakdown[];
    coverage?: TrafficCoverage;
  };
  subscriptions: Subscription[];
  networkTargets: NetworkTarget[];
  services: ServiceStatus[];
  alerts: AlertItem[];
  alertSummary?: AlertSummary;
  integrations: IntegrationStatus[];
  uiSettings: UiSettings;
}

export interface ResourceSample {
  intervalSeconds?: number;
  gapBefore?: boolean;
  capturedAt: string;
  cpuPercent: number;
  memoryPercent: number;
}

export interface UiSettings {
  showSetup: boolean;
  visiblePanels: PageId[];
  panelTitle: string;
  idleTimeoutMinutes: 2 | 5 | 10 | 15 | 20 | 30;
}

export interface LoginAppearance {
  type: "default" | "url" | "server";
  url: string;
  fit: "cover" | "contain";
  cacheSeconds?: 0 | 2 | 5 | 10 | 30 | 60 | 120 | 300 | 600;
  glass?: "clear" | "default" | "tinted";
  glassEnabled?: boolean;
  revision?: string;
}

export type LoginBackgroundSettings = Omit<LoginAppearance, "url" | "revision"> & { value: string };

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
  repeatCount?: number;
  lastStartedAt?: string;
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
  resolvedAt?: string | null;
  acknowledgedAt?: string | null;
  status?: "active" | "resolved";
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

export interface AlertSummary {
  pending: number;
  critical: number;
  warning: number;
  info: number;
  active?: number;
  recoveredPending?: number;
  total?: number;
}

export interface AlertPageResponse {
  items: AlertItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  summary: AlertSummary;
}

export interface Subscription {
  id: string;
  account: string;
  protocols: Protocol[];
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
