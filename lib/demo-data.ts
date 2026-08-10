import type {
  Account,
  AlertItem,
  AuditEvent,
  Connection,
  NavigationItem,
  NetworkTarget,
  ServiceStatus,
  Subscription,
  TrafficPoint,
  DashboardPayload,
} from "./types";

const gb = 1024 ** 3;

export const navigation: NavigationItem[] = [
  { id: "overview", label: "总览", icon: "space_dashboard" },
  { id: "accounts", label: "账号管理", icon: "group" },
  { id: "connections", label: "在线连接", icon: "lan", badge: 8 },
  { id: "traffic", label: "流量分析", icon: "monitoring" },
  { id: "subscriptions", label: "订阅管理", icon: "qr_code_2" },
  { id: "network", label: "网络质量", icon: "network_check" },
  { id: "services", label: "服务状态", icon: "dns" },
  { id: "alerts", label: "告警中心", icon: "notifications", badge: 3 },
  { id: "audit", label: "操作审计", icon: "history" },
];

export const initialAccounts: Account[] = [
  {
    id: "acc-001",
    name: "castorice",
    email: "owner@example.test",
    status: "active",
    protocols: ["Hysteria2", "AnyTLS"],
    usedBytes: 168.4 * gb,
    quotaBytes: 300 * gb,
    expiresAt: "2026-12-31T23:59:59+08:00",
    note: "主账号 · 东京节点",
    onlineDevices: 3,
  },
  {
    id: "acc-002",
    name: "silver-wolf",
    email: "member01@example.test",
    status: "active",
    protocols: ["Hysteria2", "AnyTLS", "VLESS"],
    usedBytes: 91.8 * gb,
    quotaBytes: 180 * gb,
    expiresAt: "2026-10-18T23:59:59+08:00",
    note: "日常设备",
    onlineDevices: 2,
  },
  {
    id: "acc-003",
    name: "firefly",
    email: "member02@example.test",
    status: "expiring",
    protocols: ["AnyTLS"],
    usedBytes: 77.2 * gb,
    quotaBytes: 100 * gb,
    expiresAt: "2026-08-17T23:59:59+08:00",
    note: "即将到期",
    onlineDevices: 1,
  },
  {
    id: "acc-004",
    name: "march-7th",
    email: "member03@example.test",
    status: "disabled",
    protocols: ["Hysteria2"],
    usedBytes: 28.5 * gb,
    quotaBytes: 80 * gb,
    expiresAt: "2026-09-30T23:59:59+08:00",
    note: "手动暂停",
    onlineDevices: 0,
  },
];

export const initialConnections: Connection[] = [
  { id: "con-1", protocol: "Hysteria2", account: "castorice", sourceIp: "203.0.113.42", ipVersion: 4, connections: 18, uploadBps: 418000, downloadBps: 4832000, connectedAt: "2026-08-07T19:21:08+08:00" },
  { id: "con-2", protocol: "AnyTLS", account: "castorice", sourceIp: "2001:db8:8a2e::27", ipVersion: 6, connections: 7, uploadBps: 129000, downloadBps: 1640000, connectedAt: "2026-08-07T18:46:41+08:00" },
  { id: "con-3", protocol: "Hysteria2", account: "silver-wolf", sourceIp: "198.51.100.86", ipVersion: 4, connections: 12, uploadBps: 87000, downloadBps: 2180000, connectedAt: "2026-08-07T20:02:17+08:00" },
  { id: "con-4", protocol: "VLESS", account: "silver-wolf", sourceIp: "203.0.113.119", ipVersion: 4, connections: 5, uploadBps: 44000, downloadBps: 690000, connectedAt: "2026-08-07T19:56:29+08:00" },
  { id: "con-5", protocol: "AnyTLS", account: "firefly", sourceIp: "2001:db8:4d12::91", ipVersion: 6, connections: 9, uploadBps: 178000, downloadBps: 2960000, connectedAt: "2026-08-07T20:11:03+08:00" },
];

export const hourlyTraffic: TrafficPoint[] = [
  { label: "00:00", upload: 0.9, download: 4.2 }, { label: "02:00", upload: 0.5, download: 2.8 },
  { label: "04:00", upload: 0.3, download: 1.4 }, { label: "06:00", upload: 0.7, download: 3.1 },
  { label: "08:00", upload: 1.4, download: 7.6 }, { label: "10:00", upload: 1.8, download: 10.2 },
  { label: "12:00", upload: 2.1, download: 12.8 }, { label: "14:00", upload: 1.7, download: 9.4 },
  { label: "16:00", upload: 2.4, download: 14.6 }, { label: "18:00", upload: 3.2, download: 19.8 },
  { label: "20:00", upload: 3.8, download: 24.2 }, { label: "22:00", upload: 2.6, download: 16.5 },
];

export const dailyTraffic: TrafficPoint[] = Array.from({ length: 14 }, (_, index) => ({
  label: `8/${String(index + 1).padStart(2, "0")}`,
  upload: 4.8 + ((index * 7) % 8) * 0.7,
  download: 18 + ((index * 11) % 17) * 1.35,
}));

export const protocolTraffic = [
  { name: "Hysteria2", value: 238.6, color: "var(--chart-primary)" },
  { name: "AnyTLS", value: 104.3, color: "var(--chart-secondary)" },
  { name: "VLESS", value: 22.1, color: "var(--chart-tertiary)" },
  { name: "其他", value: 1.2, color: "var(--chart-muted)" },
];

export const accountTraffic = [
  { name: "castorice", value: 168.4 },
  { name: "silver-wolf", value: 91.8 },
  { name: "firefly", value: 77.2 },
  { name: "march-7th", value: 28.5 },
];

export const networkTargets: NetworkTarget[] = [
  { id: "net-1", name: "Google", provider: "Google", address: "dns.google", ipVersion: 4, latency: 2.8, jitter: 0.6, loss: 0, status: "healthy", history: [3.2, 2.7, 2.9, 3.1, 2.6, 2.8, 2.7, 2.8] },
  { id: "net-2", name: "Cloudflare", provider: "Cloudflare", address: "1.1.1.1", ipVersion: 4, latency: 1.9, jitter: 0.4, loss: 0, status: "healthy", history: [2.1, 1.8, 1.9, 2.2, 1.7, 1.8, 2.0, 1.9] },
  { id: "net-3", name: "AWS 东京", provider: "Amazon", address: "ap-northeast-1", ipVersion: 4, latency: 4.6, jitter: 1.1, loss: 0.2, status: "healthy", history: [4.1, 4.8, 4.3, 4.5, 5.2, 4.4, 4.7, 4.6] },
  { id: "net-4", name: "Microsoft", provider: "Microsoft", address: "azure.com", ipVersion: 6, latency: 7.4, jitter: 1.8, loss: 0, status: "healthy", history: [6.8, 7.1, 8.4, 7.9, 6.9, 7.2, 7.8, 7.4] },
  { id: "net-5", name: "GitHub", provider: "GitHub", address: "github.com", ipVersion: 4, latency: 9.8, jitter: 3.4, loss: 1.2, status: "degraded", history: [8.1, 9.2, 13.8, 8.7, 10.4, 9.1, 11.3, 9.8] },
  { id: "net-6", name: "Apple", provider: "Apple", address: "apple.com", ipVersion: 6, latency: 6.1, jitter: 0.9, loss: 0, status: "healthy", history: [6.4, 5.8, 6.0, 6.3, 6.1, 5.9, 6.2, 6.1] },
];

export const services: ServiceStatus[] = [
  { id: "svc-1", name: "Hysteria2", detail: "UDP · :443 · 3 个在线账号", status: "running", version: "2.6.x", uptime: "18天 04:21", icon: "bolt" },
  { id: "svc-2", name: "AnyTLS", detail: "sing-box · TCP · :443", status: "running", version: "1.13.x", uptime: "18天 04:21", icon: "encrypted" },
  { id: "svc-3", name: "Nginx", detail: "HTTPS 与订阅反向代理", status: "running", version: "1.26.x", uptime: "18天 04:20", icon: "language" },
  { id: "svc-4", name: "Linux 内核", detail: "Debian · BBR + fq", status: "running", version: "6.12.x", uptime: "18天 04:23", icon: "memory" },
  { id: "svc-5", name: "TLS 证书", detail: "剩余 84 天 · 自动续期", status: "running", version: "ECDSA P-256", uptime: "下次检查 11小时", icon: "verified_user" },
  { id: "svc-6", name: "系统更新", detail: "2 个安全更新待安装", status: "warning", version: "Debian stable", uptime: "6小时前检查", icon: "system_update" },
];

export const initialAlerts: AlertItem[] = [
  { id: "alert-1", severity: "warning", title: "月度流量已使用 73%", description: "按当前速度预计 9 月 3 日耗尽，建议关注晚间峰值。", time: "3分钟前", acknowledged: false, source: "流量阈值" },
  { id: "alert-2", severity: "critical", title: "GitHub 路径出现轻微丢包", description: "最近 5 分钟 IPv4 丢包率为 1.2%，已超过 1% 阈值。", time: "12分钟前", acknowledged: false, source: "网络质量" },
  { id: "alert-3", severity: "info", title: "发现可用安全更新", description: "2 个 Debian 安全更新待评估，面板不会自动安装。", time: "6小时前", acknowledged: false, source: "系统更新" },
  { id: "alert-4", severity: "info", title: "证书续期检查通过", description: "TLS 证书自动续期模拟检查成功。", time: "昨天 03:18", acknowledged: true, source: "证书" },
];

export const auditEvents: AuditEvent[] = [
  { id: "audit-1", action: "管理员登录", category: "认证", actor: "admin", ip: "192.0.2.18", time: "2026-08-07 20:18:42", result: "成功", detail: "TOTP 二次验证通过" },
  { id: "audit-2", action: "重置订阅 Token", category: "账号", actor: "admin", ip: "192.0.2.18", time: "2026-08-07 19:42:07", result: "成功", detail: "账号：silver-wolf" },
  { id: "audit-3", action: "修改流量阈值", category: "配置", actor: "admin", ip: "192.0.2.18", time: "2026-08-07 18:31:16", result: "成功", detail: "告警阈值：70% → 75%" },
  { id: "audit-4", action: "自动熔断检查", category: "系统", actor: "system", ip: "127.0.0.1", time: "2026-08-07 18:00:00", result: "成功", detail: "当前 73%，未触发 95% 熔断阈值" },
  { id: "audit-5", action: "登录尝试", category: "认证", actor: "unknown", ip: "198.51.100.208", time: "2026-08-07 13:21:33", result: "失败", detail: "密码验证失败，来源已限速" },
  { id: "audit-6", action: "禁用账号", category: "账号", actor: "admin", ip: "192.0.2.18", time: "2026-08-06 22:05:19", result: "成功", detail: "账号：march-7th" },
];

export const initialSubscriptions: Subscription[] = [
  { id: "sub-1", account: "castorice", tokenHint: "c8F2••••Q7mK", protocols: ["Hysteria2", "AnyTLS"], updatedAt: "2分钟前", lastFetchedAt: "18秒前", enabled: true },
  { id: "sub-2", account: "silver-wolf", tokenHint: "aK91••••P0xs", protocols: ["Hysteria2", "AnyTLS", "VLESS"], updatedAt: "3天前", lastFetchedAt: "8分钟前", enabled: true },
  { id: "sub-3", account: "firefly", tokenHint: "mD72••••L4nv", protocols: ["AnyTLS"], updatedAt: "12天前", lastFetchedAt: "1小时前", enabled: true },
  { id: "sub-4", account: "march-7th", tokenHint: "wR55••••B2qa", protocols: ["Hysteria2"], updatedAt: "1个月前", lastFetchedAt: "从未", enabled: false },
];

export const resourceHistory = [
  { label: "-30m", cpu: 21, memory: 48 }, { label: "-25m", cpu: 28, memory: 49 },
  { label: "-20m", cpu: 17, memory: 49 }, { label: "-15m", cpu: 34, memory: 51 },
  { label: "-10m", cpu: 26, memory: 52 }, { label: "-5m", cpu: 42, memory: 53 },
  { label: "现在", cpu: 31, memory: 54 },
];

export const previewDashboard: DashboardPayload = {
  mode: "preview",
  generatedAt: new Date().toISOString(),
  overview: {
    nodeName: "Tokyo edge",
    nodeRegion: "Tokyo · NRT",
    cpuPercent: 31,
    cpuCores: 4,
    memoryPercent: 54,
    memoryUsedBytes: 553 * 1024 ** 2,
    memoryTotalBytes: 1024 ** 3,
    diskPercent: 18,
    diskUsedBytes: 3.6 * gb,
    diskTotalBytes: 20 * gb,
    load: [0.42, 0.36, 0.31],
    uptimeSeconds: 18 * 86400 + 4 * 3600 + 23 * 60,
    trafficUsedBytes: 366.2 * gb,
    trafficLimitBytes: 500 * gb,
    downloadBps: 12_840_000,
    uploadBps: 1_960_000,
    interface: "eth0",
    kernel: "6.12",
  },
  accounts: initialAccounts,
  connections: initialConnections,
  traffic: { hourly: hourlyTraffic, daily: dailyTraffic, protocol: protocolTraffic.map((item) => ({ name: item.name, value: item.value * gb })), account: accountTraffic.map((item) => ({ ...item, value: item.value * gb })) },
  subscriptions: initialSubscriptions,
  networkTargets,
  services,
  alerts: initialAlerts,
  auditEvents,
  integrations: [
    { id: "system", enabled: true, configured: true, status: "preview", summary: "系统指标界面演示，未连接服务器" },
    { id: "hysteria2", enabled: true, configured: true, status: "preview", summary: "Hysteria2 界面演示，未连接 API" },
    { id: "anytls", enabled: true, configured: true, status: "preview", summary: "sing-box 界面演示，未连接 API" },
    { id: "connections", enabled: true, configured: true, status: "preview", summary: "连接快照界面演示，未接入数据源" },
    { id: "traffic", enabled: true, configured: true, status: "preview", summary: "流量图表界面演示，未开始采样" },
    { id: "subscriptions", enabled: false, configured: false, status: "pending", summary: "等待配置订阅发布器" },
    { id: "network", enabled: true, configured: true, status: "preview", summary: "网络探测界面演示，未执行探测" },
    { id: "alerts", enabled: true, configured: true, status: "preview", summary: "告警界面演示，未启用规则" },
    { id: "audit", enabled: true, configured: true, status: "preview", summary: "审计界面演示，未写入记录" },
  ],
  resourceHistory,
};

export const emptyDashboard: DashboardPayload = {
  mode: "loading",
  generatedAt: new Date(0).toISOString(),
  overview: {
    nodeName: "正在连接后端",
    nodeRegion: "尚未取得服务器数据",
    cpuPercent: 0,
    cpuCores: 0,
    memoryPercent: 0,
    memoryUsedBytes: 0,
    memoryTotalBytes: 0,
    diskPercent: 0,
    diskUsedBytes: 0,
    diskTotalBytes: 0,
    load: [0, 0, 0],
    uptimeSeconds: 0,
    trafficUsedBytes: 0,
    trafficLimitBytes: 0,
    downloadBps: 0,
    uploadBps: 0,
    interface: "--",
    kernel: "--",
  },
  accounts: [],
  connections: [],
  traffic: { hourly: [], daily: [], protocol: [], account: [] },
  subscriptions: [],
  networkTargets: [],
  services: [],
  alerts: [],
  auditEvents: [],
  integrations: [],
  resourceHistory: [],
};
