import { useEffect, useState } from "react";
import { fetchNetworkHistory } from "../../lib/api";
import { useI18n } from "../../lib/i18n";
import { networkHistoryBuckets } from "../../lib/network-chart";
import type { NetworkHistoryResponse, NetworkHistorySample, NetworkTarget } from "../../lib/types";
import { NetworkChart } from "../charts/NetworkChart";
import { Button } from "../ui/Button";

export function NetworkHistory({ target }: { target: NetworkTarget }) {
  const { t } = useI18n();
  const [hours, setHours] = useState<1 | 6 | 24>(1);
  const [query, setQuery] = useState(0);
  const [fallbackEnd] = useState(() => Date.now() / 1000);
  const [result, setResult] = useState<{ hours: number; family: number; query: number; data?: NetworkHistoryResponse; error?: boolean }>();
  const family = target.resolvedIpVersion ?? target.ipVersion;
  useEffect(() => {
    if (hours === 1) return;
    const controller = new AbortController();
    let loading = false;
    const load = async () => {
      if (loading || controller.signal.aborted) return;
      loading = true;
      try {
        const data = await fetchNetworkHistory(target.id, hours, family, controller.signal);
        if (!controller.signal.aborted) setResult({ hours, family, query, data });
      } catch {
        if (!controller.signal.aborted) setResult({ hours, family, query, error: true });
      } finally { loading = false; }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [target.id, family, hours, query]);
  const current = result?.hours === hours && result.query === query && result.family === family ? result : undefined;
  const step = hours * 60;
  const samples = networkHistoryBuckets(hours === 1 ? target.timeHistory ?? [] : current?.data?.samples ?? [], step, current?.data?.start);
  const end = current?.data?.end ?? samples.at(-1)?.capturedAt ?? fallbackEnd;
  return <div className="network-target-card__chart network-history">
    <div className="network-history-toolbar">
      <strong>{t("趋势记录", "Trend history")}</strong>
      <div className="network-history-actions">
        <div className="segmented-control" aria-label={t("趋势范围", "Trend range")}>
          {([1, 6, 24] as const).map((value) => <button key={value} className={hours === value ? "is-selected" : ""} aria-pressed={hours === value} onClick={() => setHours(value)}>{value}h</button>)}
        </div>
        {hours > 1 ? <Button variant="text" icon="refresh" aria-label={t("刷新", "Refresh")} onClick={() => setQuery((value) => value + 1)} /> : null}
      </div>
    </div>
    <NetworkChart samples={samples} label={t(`${target.name} 趋势记录`, `${target.name} trend history`)} step={step} start={end - hours * 3600} end={end}
      state={hours > 1 && !current ? "loading" : current?.error ? "error" : undefined} />
  </div>;
}

export function TimeTrend({ samples, label, step = 20, start, end }: { samples: NetworkHistorySample[]; label: string; step?: number; start?: number; end?: number }) {
  return <NetworkChart samples={samples} label={label} step={step} start={start} end={end} />;
}
