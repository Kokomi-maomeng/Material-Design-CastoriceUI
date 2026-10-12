import type { LoginAppearance } from "./types";

export const BACKGROUND_TIMES = [0, 2, 5, 10, 30, 60, 120, 300, 600] as const;
export const GLASS_PRESETS = ["clear", "default", "tinted"] as const;

export function backgroundProfile(width: number, height: number): string {
  const portrait = height > width;
  const sizes = portrait ? [640, 1280, 1920] : [960, 1280, 1920, 2560, 3840];
  const size = sizes.find((candidate) => width <= candidate) ?? sizes[sizes.length - 1];
  return `${portrait ? "portrait" : "landscape"}-${size}`;
}

export function backgroundCacheKey(appearance: LoginAppearance, profile: string): string {
  return `/api/v2/auth/background?profile=${encodeURIComponent(profile)}&revision=${encodeURIComponent(appearance.revision ?? "legacy")}`;
}

export function pendingCriticalAlerts(summary: { critical: number } | undefined, alerts: Array<{ severity: string; acknowledged: boolean }>): number {
  return summary?.critical ?? alerts.filter((item) => item.severity === "critical" && !item.acknowledged).length;
}
