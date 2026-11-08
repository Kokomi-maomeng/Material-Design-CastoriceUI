import type { NavigationItem, PageId } from "./types";

export const PANEL_IDS: PageId[] = [
  "alerts",
  "accounts",
  "services",
  "network",
  "traffic",
  "audit",
];

export const navigation: NavigationItem[] = [
  { id: "overview", labelZh: "总览", labelEn: "Overview", icon: "space_dashboard" },
  { id: "setup", labelZh: "初始化向导", labelEn: "Setup", icon: "checklist" },
  { id: "alerts", labelZh: "告警中心", labelEn: "Alerts", icon: "notifications" },
  { id: "accounts", labelZh: "账号管理", labelEn: "Account management", icon: "group" },
  { id: "services", labelZh: "服务状态", labelEn: "Services", icon: "dns" },
  { id: "network", labelZh: "网络质量", labelEn: "Network", icon: "network_check" },
  { id: "traffic", labelZh: "流量分析", labelEn: "Traffic analytics", icon: "monitoring" },
  { id: "audit", labelZh: "审计中心", labelEn: "Audit center", icon: "history" },
];

export type PageRoute = PageId | "traffic/connections";
