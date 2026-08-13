import type { NavigationItem } from "./types";

export const navigation: NavigationItem[] = [
  { id: "overview", labelZh: "总览", labelEn: "Overview", icon: "space_dashboard" },
  { id: "setup", labelZh: "初始化向导", labelEn: "Setup", icon: "checklist" },
  { id: "accounts", labelZh: "账号状态", labelEn: "Account status", icon: "group" },
  { id: "connections", labelZh: "在线连接", labelEn: "Connections", icon: "lan" },
  { id: "traffic", labelZh: "流量分析", labelEn: "Traffic", icon: "monitoring" },
  { id: "subscriptions", labelZh: "订阅管理", labelEn: "Subscriptions", icon: "qr_code_2" },
  { id: "network", labelZh: "网络质量", labelEn: "Network", icon: "network_check" },
  { id: "services", labelZh: "服务状态", labelEn: "Services", icon: "dns" },
  { id: "alerts", labelZh: "告警中心", labelEn: "Alerts", icon: "notifications" },
  { id: "audit", labelZh: "操作审计", labelEn: "Audit", icon: "history" },
];
