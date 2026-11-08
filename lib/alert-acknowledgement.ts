import type { AlertItem, AlertSummary } from "./types";

export type AlertAcknowledgement = AlertItem | "all";

export function acknowledgedItems(items: AlertItem[], change: AlertAcknowledgement, pendingOnly = false) {
  if (change === "all" && pendingOnly) return [];
  const matches = (item: AlertItem) => !item.acknowledged && (change === "all" || item.episodeId === change.episodeId);
  return pendingOnly
    ? items.filter((item) => !matches(item))
    : items.map((item) => matches(item) ? { ...item, acknowledged: true } : item);
}

export function acknowledgedSummary(summary: AlertSummary, change: AlertAcknowledgement): AlertSummary {
  if (change === "all") return { ...summary, pending: 0, critical: 0, warning: 0, info: 0, recoveredPending: 0 };
  return {
    ...summary,
    pending: Math.max(0, summary.pending - 1),
    [change.severity]: Math.max(0, summary[change.severity] - 1),
    recoveredPending: change.status === "resolved" && summary.recoveredPending !== undefined
      ? Math.max(0, summary.recoveredPending - 1)
      : summary.recoveredPending,
  };
}
