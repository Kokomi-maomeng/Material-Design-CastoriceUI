import { useEffect, useState } from "react";
import { fetchMonitoringContext } from "../../lib/api";
import { formatBytes, formatLocalDateTime } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { MonitoringContext, NetworkTarget } from "../../lib/types";
import { Button } from "../ui/Button";

export function NetworkDiagnosis({ targets }: { targets: NetworkTarget[] }) {
  const { language, t } = useI18n();
  const [open, setOpen] = useState(false);
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState<MonitoringContext>();
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetchMonitoringContext(controller.signal).then((value) => {
      if (!controller.signal.aborted) { setData(value); setError(false); }
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [open, retry]);
  const correlation = data?.networkCorrelation;
  const official = data?.officialStatus;
  const resource = data?.resource?.at(-1);
  const classification = correlation?.classification;
  const description = classification === "multiple-targets" ? t("多个目标共同异常", "Multiple target directions affected") : classification === "target-direction" ? t("单个目标方向异常", "One target direction affected") : classification === "no-current-anomaly" ? t("当前完整样本未发现异常", "No anomaly in the current complete samples") : t("采样证据不足", "Insufficient sample evidence");
  const at = (value?: string) => value ? formatLocalDateTime(value, language) : "—";
  return <details className="network-diagnosis" onToggle={(event) => setOpen(event.currentTarget.open)}><summary>{t("同期关联与官方事件", "Correlation and official incidents")}</summary>
    {error ? <p role="alert">{t("诊断读取失败", "Unable to load diagnostics")}</p> : !data ? <p role="status">{t("正在读取诊断", "Loading diagnostics")}</p> : <>
      <dl className="monitoring-evidence-list"><div><dt>{t("当前候选结论", "Current candidate")}</dt><dd>{description} · {at(correlation?.observedAt)}</dd></div><div><dt>{t("异常目标", "Affected targets")}</dt><dd>{correlation?.affectedTargets?.map((id) => targets.find((target) => target.id === id)?.name ?? id).join(" / ") || "—"}{correlation?.ipVersions?.length ? ` · ${correlation.ipVersions.map((family) => `IPv${family}`).join(" / ")}` : ""}</dd></div>
      <div><dt>{t("完整正常目标", "Complete normal targets")}</dt><dd>{correlation?.normalSamples ?? "—"}</dd></div><div><dt>Cloudflare</dt><dd>{official?.status === "retrieved" ? t("已取得官方事件列表", "Official incident list retrieved") : t("官方状态无法确认", "Official status unconfirmed")} · {at(official?.observedAt)}</dd></div>
      <div><dt>{t("本机资源采样", "Local resource sample")}</dt><dd>{at(resource?.observedAt)}{typeof resource?.memoryBytes === "number" ? ` · ${formatBytes(resource.memoryBytes)}` : ""}</dd></div><div><dt>{t("内存压力增量", "Memory pressure delta")}</dt><dd>high {resource?.memoryEventDelta?.high ?? "—"} · OOM {resource?.memoryEventDelta?.oom ?? "—"}</dd></div></dl>
      {official?.status === "retrieved" && official.incidents?.length ? <ul className="network-official-incidents">{official.incidents.slice(0, 3).map((item) => <li key={item.id}><strong>{item.name ?? item.id}</strong><span>{item.status ?? "—"} · {at(item.started_at)} – {at(item.resolved_at)}</span>{item.components?.length ? <small>{item.components.map((part) => part.name).filter(Boolean).join(" / ")}</small> : null}</li>)}</ul> : null}
      <p>{t("时间重叠仅是候选关联；出站探测、官方事件及资源计数不能单独证明线路或提供商根因。未保存的历史路由无法补推。", "Time overlap is a candidate association. Outbound probes, official incidents and resource counters alone do not establish a line or provider root cause. Unsaved historical routes cannot be reconstructed.")}</p>
    </>}
    <Button variant="text" icon="refresh" onClick={() => setRetry((value) => value + 1)}>{t("刷新诊断", "Refresh diagnostics")}</Button>
  </details>;
}
