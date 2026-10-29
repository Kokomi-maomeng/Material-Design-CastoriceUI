import type { NetworkHistorySample, NetworkTarget } from "./types";

export const NETWORK_CHART_POINTS = 60;

export function networkProbeSamples(target: NetworkTarget): NetworkHistorySample[] {
  if (target.probeHistory) return target.probeHistory.slice(-NETWORK_CHART_POINTS);
  if (target.timeHistory?.length) return target.timeHistory.slice(-NETWORK_CHART_POINTS);
  const capturedAt = Date.parse(target.observedAt ?? "") / 1000;
  return Number.isFinite(capturedAt) ? [{ capturedAt, latency: target.latency, loss: target.loss,
    complete: target.complete !== false, status: target.status }] : [];
}

/** Bucket real observations without filling missing intervals with healthy data. */
export function networkHistoryBuckets(samples: NetworkHistorySample[], step: number, start?: number): NetworkHistorySample[] {
  const buckets = new Map<number, NetworkHistorySample>();
  for (const sample of [...samples].filter((item) => Number.isFinite(item.capturedAt)).sort((a, b) => a.capturedAt - b.capturedAt)) {
    const capturedAt = start === undefined ? Math.floor(sample.capturedAt / step) * step
      : start + Math.max(0, Math.min(59, Math.floor((sample.capturedAt - start) / step))) * step;
    const previous = buckets.get(capturedAt);
    const usable = sample.complete;
    const maximum = (key: "latency" | "loss") => {
      const value = usable && typeof sample[key] === "number" && Number.isFinite(sample[key]) ? sample[key] : null;
      return value === null ? previous?.[key] ?? null : Math.max(previous?.[key] ?? value, value);
    };
    buckets.set(capturedAt, { capturedAt, latency: maximum("latency"), loss: maximum("loss"),
      complete: usable || previous?.complete === true,
      hasGaps: !usable || sample.hasGaps === true || previous?.hasGaps === true,
      status: sample.status, samples: (previous?.samples ?? 0) + (sample.samples ?? 1) });
  }
  return [...buckets.values()].slice(-NETWORK_CHART_POINTS);
}

export function networkTimeLabel(at: number, seconds: boolean, language: "zh" | "en") {
  const date = new Date(at * 1000);
  return seconds ? `${date.getSeconds()}s` : date.toLocaleTimeString(language === "zh" ? "zh-CN" : "en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
}
