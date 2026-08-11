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
  { id: "system", name: "系统指标", icon: "memory", page: "overview", summary: "读取主机资源、运行时间和网卡累计计数器。", outcome: "总览获得真实运行快照和 1 小时至 7 天的进出流量趋势。", steps: ["确认后端只监听本机回环地址", "在设置中填写节点显示名称", "确认主网卡采样持续写入 SQLite"], fields: [] },
  { id: "hysteria2", name: "Hysteria2", icon: "bolt", page: "services", summary: "通过官方 Traffic Stats API 获取账号累计流量、在线计数与活动流。", outcome: "账号身份按显式映射匹配；只有单账号单身份时才使用无歧义自动关联。", steps: ["在服务端启用仅回环监听的 Traffic Stats API", "把独立 API Secret 写入权限为 0640 的服务器配置", "多账号时在 managed_accounts 配置 trafficIdentities 映射"], fields: [{ id: "endpoint", label: "API 地址", placeholder: "http://127.0.0.1:19090", hint: "只接受 localhost 或回环 IP；Secret 不会通过网页提交或存入 SQLite。", required: true }] },
  { id: "anytls", name: "AnyTLS / sing-box", icon: "encrypted", page: "services", summary: "连接 sing-box 的本机 Clash API，读取连接快照与累计上下行统计。", outcome: "只显示核心实际返回的连接、来源地址、累计流量和时间字段。", steps: ["让 Clash API 仅监听 127.0.0.1", "把 Bearer Secret 写入权限为 0640 的服务器配置", "保存回环地址并检查真实连接快照"], fields: [{ id: "endpoint", label: "Clash API 地址", placeholder: "http://127.0.0.1:19091", hint: "只接受 localhost 或回环 IP；Secret 仅从服务器受限配置读取。", required: true }] },
  { id: "connections", name: "连接活动", icon: "lan", page: "connections", summary: "按协议、账号和来源 IP 聚合活动条目，并按需展开真实目标。", outcome: "持续时长取组内最早时间；速率仅由相邻累计字节快照计算。", steps: ["确认至少一个协议适配器已连接", "等待两个连续快照建立速率基线", "核对缺失来源 IP 的条目明确标为核心未提供"], fields: [] },
  { id: "traffic", name: "流量采集", icon: "monitoring", page: "traffic", summary: "持久化网卡计数器，生成 1h、6h、24h、3 天和 7 天进出流量。", outcome: "总览和流量分析使用相邻真实计数器的非负增量。", steps: ["确认主网卡", "设置月度总额度", "等待至少两个采样点形成趋势"], fields: [{ id: "interface", label: "主网卡", placeholder: "eth0", hint: "通常由默认路由自动识别。" }, { id: "quotaGb", label: "月度额度（GB）", placeholder: "1000", type: "number", hint: "用于剩余流量、预计耗尽日期和告警。" }] },
  { id: "subscriptions", name: "订阅配置", icon: "qr_code_2", page: "subscriptions", summary: "展示服务器受保护配置中的订阅记录，并校验所填基地址为 HTTPS 格式。", outcome: "可以按需从受保护端点读取已配置地址；不声称外部发布器已经连通。", steps: ["确认订阅发布服务已启用 TLS", "填写不会泄露真实凭据的公共基地址", "注意保存只校验格式，不探测发布器可达性"], fields: [{ id: "baseUrl", label: "订阅基地址", placeholder: "https://panel.example.com/subscription", hint: "不要在此字段中直接粘贴 Token；通过 HTTPS 格式校验不等于发布器已连通。", required: true }] },
  { id: "network", name: "网络质量", icon: "network_check", page: "network", summary: "自定义 IPv4/IPv6 目标，计算延迟、抖动与丢包。", outcome: "保存后替换预设目标并立即清除旧探测缓存。", steps: ["每行填写地址，或使用 名称,地址", "最多配置 12 个可解析目标", "检查 ICMP 被禁时的不可达状态"], fields: [{ id: "targets", label: "自定义探测目标", placeholder: "Cloudflare,1.1.1.1\nGoogle IPv6,2001:4860:4860::8888", type: "textarea", hint: "每行使用“名称,IP/域名”或只填 IP/域名，最多 12 个。" }] },
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
