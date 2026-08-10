import type { IntegrationId, PageId } from "./types";

export interface SetupField {
  id: string;
  label: string;
  placeholder: string;
  type?: "text" | "password" | "number" | "textarea";
  hint: string;
  required?: boolean;
}

export interface IntegrationDefinition {
  id: IntegrationId;
  name: string;
  icon: string;
  page?: PageId;
  summary: string;
  outcome: string;
  steps: string[];
  fields: SetupField[];
}

export const integrationDefinitions: IntegrationDefinition[] = [
  { id: "system", name: "系统指标", icon: "memory", page: "overview", summary: "读取 CPU、内存、磁盘、负载、运行时间和主机网络计数器。", outcome: "总览获得真实资源数据与剩余流量预测。", steps: ["确认后端只监听本机回环地址", "选择用于统计流量的主网卡", "检查采样数据是否持续更新"], fields: [] },
  { id: "hysteria2", name: "Hysteria2", icon: "bolt", page: "services", summary: "通过官方 Traffic Stats API 获取账号流量、在线设备与活动流。", outcome: "在线连接和流量分析可按 Hysteria2 账号展示。", steps: ["在服务端启用仅回环监听的 Traffic Stats API", "把独立 API Secret 写入权限为 0640 的服务器配置", "填写回环地址并执行真实连通与鉴权测试"], fields: [{ id: "endpoint", label: "API 地址", placeholder: "http://127.0.0.1:19090", hint: "只接受 localhost 或回环 IP；Secret 不会通过网页提交或存入 SQLite。", required: true }] },
  { id: "anytls", name: "AnyTLS / sing-box", icon: "encrypted", page: "services", summary: "连接 sing-box 的本机 Clash API，读取实时连接和上下行统计。", outcome: "AnyTLS 连接、来源地址与实时流量可见。", steps: ["让 Clash API 仅监听 127.0.0.1", "把 Bearer Secret 写入权限为 0640 的服务器配置", "保存回环地址并检查真实连接快照"], fields: [{ id: "endpoint", label: "Clash API 地址", placeholder: "http://127.0.0.1:19091", hint: "只接受 localhost 或回环 IP；Secret 仅从服务器受限配置读取。", required: true }] },
  { id: "connections", name: "在线连接", icon: "lan", page: "connections", summary: "合并协议 API 与系统套接字，形成统一的实时连接视图。", outcome: "显示协议、账号、来源 IP、连接数、速率和持续时间。", steps: ["确认至少一个协议适配器已连接", "自动读取核心可提供的字段", "无法由核心提供的来源信息会明确标注"], fields: [] },
  { id: "traffic", name: "流量采集", icon: "monitoring", page: "traffic", summary: "持久化网卡计数器并合并协议统计，生成小时、天和协议趋势。", outcome: "总览和流量分析使用服务器真实计数。", steps: ["确认主网卡", "设置月度总额度", "等待首个采样周期形成趋势"], fields: [{ id: "interface", label: "主网卡", placeholder: "eth0", hint: "通常由默认路由自动识别。" }, { id: "quotaGb", label: "月度额度（GB）", placeholder: "1000", type: "number", hint: "用于剩余流量、预计耗尽日期和告警。" }] },
  { id: "subscriptions", name: "订阅管理", icon: "qr_code_2", page: "subscriptions", summary: "连接已有订阅发布器，集中展示每个账号的入口和 Token 状态。", outcome: "可以安全复制地址并按需生成二维码。", steps: ["确认订阅发布服务已启用 TLS", "填写不会泄露真实凭据的公共基地址", "账号订阅记录由服务器配置同步"], fields: [{ id: "baseUrl", label: "订阅基地址", placeholder: "https://panel.example.com/subscription", hint: "不要在此字段中直接粘贴 Token。", required: true }] },
  { id: "network", name: "网络质量", icon: "network_check", page: "network", summary: "周期探测 IPv4/IPv6 目标，计算延迟、抖动与丢包。", outcome: "大厂线路和自定义目标具有可比较的质量趋势。", steps: ["准备 IPv4 与 IPv6 目标", "设置合理探测间隔", "检查 ICMP 被禁时的失败状态"], fields: [{ id: "targets", label: "探测目标", placeholder: "1.1.1.1\n2606:4700:4700::1111", type: "textarea", hint: "每行一个 IP 或域名，建议不超过 12 个。" }] },
  { id: "alerts", name: "告警中心", icon: "notifications", page: "alerts", summary: "根据流量、服务、证书和网络质量自动产生可确认告警。", outcome: "异常状态不再依赖人工逐页检查。", steps: ["设置流量阈值", "设置延迟和丢包阈值", "确认告警确认记录可以写入"], fields: [{ id: "trafficPercent", label: "流量告警阈值（%）", placeholder: "80", type: "number", hint: "达到阈值时生成告警。" }, { id: "lossPercent", label: "丢包阈值（%）", placeholder: "5", type: "number", hint: "建议避免设置得过低造成噪声。" }] },
  { id: "audit", name: "操作审计", icon: "history", page: "audit", summary: "记录配置更新、告警确认和后端生命周期等关键事件。", outcome: "重要变更具有时间、来源与结果记录。", steps: ["确认数据库目录权限", "由服务器配置保留周期", "验证密码、Token 和私钥不会进入审计详情"], fields: [] },
];

export const pageIntegration: Partial<Record<PageId, IntegrationId>> = {
  accounts: "hysteria2",
  connections: "connections",
  traffic: "traffic",
  subscriptions: "subscriptions",
  network: "network",
  services: "system",
  alerts: "alerts",
  audit: "audit",
};
