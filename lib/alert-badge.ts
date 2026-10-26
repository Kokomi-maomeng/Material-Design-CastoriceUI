import type { AlertItem, DashboardPayload } from "./types";

export function alertBadge(summary: DashboardPayload["alertSummary"], alerts: AlertItem[]) {
  const count = (severity: AlertItem["severity"]) => summary?.[severity] ?? alerts.filter((item) => !item.acknowledged && item.severity === severity).length;
  return { count: count("critical") + count("warning"), critical: count("critical"), reminders: count("info") };
}
