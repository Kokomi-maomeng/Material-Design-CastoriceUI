import { useEffect, useState } from "react";
import { fetchNetworkHistory } from "../../lib/api";
import { formatLocalDateTime, formatTimeSpan, localTimeZone } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { NetworkHistoryResponse, NetworkHistorySample, NetworkTarget } from "../../lib/types";
import { Button } from "../ui/Button";

export function NetworkHistory({ target }: { target: NetworkTarget }) {
  const { t } = useI18n();
  const [hours, setHours] = useState<1 | 6 | 24>(1);
  const [query, setQuery] = useState(0);
  const [result, setResult] = useState<{ hours: number; family: number; query: number; data?: NetworkHistoryResponse; error?: boolean }>();
  const family = target.resolvedIpVersion ?? target.ipVersion;
  useEffect(() => {
    if (hours === 1) return;
    const controller = new AbortController();
    void fetchNetworkHistory(target.id, hours, family, controller.signal).then((data) => {
      if (!controller.signal.aborted) setResult({ hours, family, query, data });
    }).catch(() => { if (!controller.signal.aborted) setResult({ hours, family, query, error: true }); });
    return () => controller.abort();
  }, [target.id, family, hours, query]);
  const current = result?.hours === hours && result.query === query && result.family === family ? result : undefined;
  const samples = hours === 1 ? target.timeHistory ?? [] : current?.data?.samples ?? [];
  return <div className="network-target-card__chart">
    <div className="network-history-toolbar"><strong>{t("真实时间趋势", "Measured time trend")}</strong><div className="segmented-control" aria-label={t("趋势范围", "Trend range")}>
      {([1, 6, 24] as const).map((value) => <button key={value} className={hours === value ? "is-selected" : ""} aria-pressed={hours === value} onClick={() => setHours(value)}>{value}h</button>)}
    </div></div>
    {hours > 1 && !current ? <p role="status">{t("正在读取历史", "Loading history")}</p> : current?.error ? <p role="alert">{t("历史读取失败", "Unable to load history")}</p> : samples.length ? <TimeTrend samples={samples} label={t(`${target.name} 时间趋势`, `${target.name} time trend`)} step={current?.data?.granularitySeconds ?? 20} start={current?.data?.start} end={current?.data?.end} /> : <p>{t("该范围暂无已保存样本", "No saved samples in this range")}</p>}
    <small>{hours === 1 ? t("最近一小时真实趋势 · 缺测处断开", "Measured hour · gaps preserved") : t(`${formatTimeSpan(current?.data?.granularitySeconds ?? (hours === 6 ? 120 : 300))} 聚合最坏值 · 缺测标红 · 已保存 ${current?.data?.sourceSamples ?? 0} 轮`, `${formatTimeSpan(current?.data?.granularitySeconds ?? (hours === 6 ? 120 : 300))} bucket maxima · gaps marked · ${current?.data?.sourceSamples ?? 0} saved rounds`)}</small>
    {hours > 1 ? <div className="network-history-refresh"><small>{t("记录保留最多 7d，受共享容量上限约束；空白不是正常样本。", "Retention is up to 7d within the shared capacity limit; blanks are not healthy samples.")}{current?.data?.truncated ? t(" 查询达到上限，较早样本未包含。", " Query limit reached; earlier samples are omitted.") : ""}</small><Button variant="text" icon="refresh" onClick={() => setQuery((value) => value + 1)}>{t("刷新", "Refresh")}</Button></div> : null}
  </div>;
}

export function TimeTrend({ samples, label, step = 20, start: requestedStart, end: requestedEnd }: { samples: NetworkHistorySample[]; label: string; step?: number; start?: number; end?: number }) {
  const { language, t } = useI18n();
  if (!samples.length) return null;
  const start = requestedStart ?? samples[0].capturedAt;
  const end = requestedEnd ?? samples[samples.length - 1].capturedAt;
  const maximum = Math.max(1, ...samples.map((item) => item.complete ? item.latency ?? 0 : 0));
  const x = (at: number) => 34 + 252 * Math.max(0, Math.min(1, (at - start) / Math.max(1, end - start)));
  const paths = (metric: "latency" | "loss", scale: number) => {
    const segments: string[][] = []; let segment: string[] = []; let previous: number | undefined;
    for (const sample of samples) {
      const value = sample[metric];
      const usable = typeof value === "number" && Number.isFinite(value) && sample.complete;
      if (!usable || sample.hasGaps || previous !== undefined && sample.capturedAt - previous > step * 1.5) {
        if (segment.length) segments.push(segment); segment = [];
      }
      if (usable) segment.push(`${x(sample.capturedAt)},${72 - Math.min(scale, Math.max(0, value)) / scale * 60}`);
      if (sample.hasGaps && segment.length) { segments.push(segment); segment = []; }
      previous = sample.capturedAt;
    }
    if (segment.length) segments.push(segment);
    return segments.map((points, index) => points.length > 1 ? <polyline key={index} data-metric={metric} points={points.join(" ")} fill="none" stroke={metric === "latency" ? "var(--primary)" : "var(--warning)"} strokeWidth="2" /> : <circle key={index} data-metric={metric} cx={points[0].split(",")[0]} cy={points[0].split(",")[1]} r="2" fill={metric === "latency" ? "var(--primary)" : "var(--warning)"} />);
  };
  const time = (at: number) => formatLocalDateTime(new Date(at * 1000).toISOString(), language);
  return <div className="network-time-trend"><svg viewBox="0 0 320 90" role="img" aria-label={label}><title>{label}</title><line x1="34" y1="72" x2="286" y2="72" stroke="var(--outline-variant)" /><text x="30" y="14" textAnchor="end" fill="var(--on-surface-variant)" fontSize="10">{maximum.toFixed(1)}</text><text x="30" y="75" textAnchor="end" fill="var(--on-surface-variant)" fontSize="10">0</text><text x="290" y="14" fill="var(--on-surface-variant)" fontSize="10">100%</text><text x="290" y="75" fill="var(--on-surface-variant)" fontSize="10">0%</text>{samples.filter((sample) => !sample.complete || sample.hasGaps).map((sample, index) => <line key={index} data-gap="true" x1={x(sample.capturedAt)} x2={x(sample.capturedAt)} y1="12" y2="72" stroke="var(--error)" strokeOpacity=".35" strokeDasharray="2 3" />)}{paths("latency", maximum)}{paths("loss", 100)}</svg><div className="network-time-trend__legend"><span style={{ color: "var(--primary)" }}>{t("延迟 ms", "Latency ms")}</span><span style={{ color: "var(--warning)" }}>{t("丢包 %", "Loss %")}</span></div><small>{time(start)} – {time(end)} · {localTimeZone()}</small></div>;
}
