import type { NetworkTarget } from "./types";

export function networkQuality(targets: NetworkTarget[]): "empty" | "poor" | "unavailable" | "recovering" | "excellent" {
  if (!targets.length) return "empty";
  if (targets.some((target) => target.status === "down" || target.status === "degraded")) return "poor";
  if (targets.some((target) => target.status === "unavailable" || target.complete === false || target.latency === null || target.loss === null)) return "unavailable";
  if (targets.some((target) => target.alertConfirmed || target.qualityWindow?.confirmation === "recovering")) return "recovering";
  return "excellent";
}

export const qualityLabels = {
  empty: ["暂无数据", "No data"], poor: ["较差", "Poor"],
  unavailable: ["部分不可用", "Partially unavailable"], recovering: ["恢复观察", "Recovering"],
  excellent: ["优秀", "Excellent"],
} as const;
