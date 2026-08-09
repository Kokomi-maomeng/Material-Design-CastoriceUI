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
  ipVersion: 4 | 6;
  connections: number;
  uploadBps: number;
  downloadBps: number;
  connectedAt: string;
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
  uptime: string;
  icon: string;
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
