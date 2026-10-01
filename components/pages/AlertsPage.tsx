"use client";

import { useEffect, useRef, useState } from "react";
import { fetchAlerts } from "../../lib/api";
import { formatLocalDateTime, localTimeZone } from "../../lib/format";
import { useI18n, withoutTerminalPeriod } from "../../lib/i18n";
import type { AlertItem, AlertPageResponse, AlertSummary, IntegrationStatus } from "../../lib/types";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { RecordHistoryControls, RecordPagination } from "../ui/RecordHistory";

export function AlertsPage({ alerts, onAcknowledge, onAcknowledgeAll, onToast, onSummaryChange, integration, onConfigure }: {
  alerts: AlertItem[];
  onAcknowledge: (episodeId: string) => Promise<void>;
  onAcknowledgeAll: () => Promise<void>;
  onToast: (message: string) => void;
  onSummaryChange?: (summary: AlertSummary) => void;
  integration?: IntegrationStatus;
  onConfigure: () => void;
}) {
  const { language, t } = useI18n();
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<AlertPageResponse>({ items: [], total: 0, page: 1, pageSize: 50, totalPages: 1, summary: { pending: 0, critical: 0, warning: 0, info: 0 } });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const summaryCallback = useRef(onSummaryChange);
  useEffect(() => { summaryCallback.current = onSummaryChange; }, [onSummaryChange]);
  const paginated = filter === "pending" || expanded;
  useEffect(() => {
    const controller = new AbortController();
    void fetchAlerts({ page: paginated ? page : 1, pageSize: paginated ? 50 : 30, filter, signal: controller.signal }).then((data) => {
      if (controller.signal.aborted) return;
      setResult(data);
      setLoadError(false);
      summaryCallback.current?.(data.summary);
      if (paginated && data.page !== page) setPage(data.page);
    }).catch(() => { if (!controller.signal.aborted) setLoadError(true); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [alerts, filter, paginated, page, refresh]);

  const selectFilter = (value: "pending" | "all") => { if (value === filter) return; setFilter(value); setExpanded(false); setPage(1); setLoading(true); };
  const confirm = async (episodeId?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      if (episodeId) await onAcknowledge(episodeId); else await onAcknowledgeAll();
      setRefresh((value) => value + 1);
    } catch {
      onToast(t("告警确认失败，请重试", "Unable to acknowledge the alert. Try again."));
    } finally { setBusy(false); }
  };
  const summary = result.summary;
  const visible = loading || loadError ? [] : result.items;
  return <div className="page-content page-enter">
    <PageHeader eyebrow={t("主动监控", "Proactive monitoring")} title={t("告警中心", "Alerts")} description={t(`告警保留在待处理，直到手动确认；时间按本地时区 ${localTimeZone()} 显示。`, `Alerts remain pending until you acknowledge them. Times use your local time zone: ${localTimeZone()}.`)} />
    <IntegrationGate status={integration} name="告警规则" nameEn="Alert rules" description="设置流量、延迟和丢包阈值后，异常会自动进入待处理列表。" descriptionEn="Set traffic, latency, and packet-loss thresholds to place real anomalies in the pending list." onConfigure={onConfigure} />
    <section className="alert-summary">{(["critical", "warning", "info"] as const).map((severity) => <Card key={severity} variant="filled"><span className={`alert-count alert-count--${severity}`}>{summary[severity]}</span><div><strong>{severity === "critical" ? t("严重", "Critical") : severity === "warning" ? t("警告", "Warning") : t("提醒", "Info")}</strong></div></Card>)}</section>
    <Card variant="outlined" className="alert-panel">
      <div className="table-toolbar"><div className="filter-chips"><Chip selected={filter === "pending"} onClick={() => selectFilter("pending")}>{t("待处理", "Pending")} {summary.pending}</Chip><Chip selected={filter === "all"} onClick={() => selectFilter("all")}>{t("全部记录", "All records")}</Chip></div><Button variant="text" compact icon="done_all" disabled={busy || loading || loadError || summary.pending === 0} onClick={() => void confirm()}>{t("全部确认", "Acknowledge all")}</Button></div>
      <div className="alert-list" aria-busy={loading}>
        {visible.map((alert) => <div className={`alert-row alert-row--${alert.severity} ${alert.acknowledged ? "is-acknowledged" : ""}`} key={alert.episodeId}>
          <span className="alert-row__icon"><Icon name={alert.severity === "critical" ? "error" : alert.severity === "warning" ? "warning" : "info"} size={23} filled /></span>
          <div className="alert-row__content"><div><strong>{language === "zh" ? alert.titleZh || alert.title : alert.titleEn || alert.title}</strong><Chip staticChip>{language === "zh" ? alert.sourceZh || alert.source : alert.sourceEn || alert.source}</Chip></div><p>{withoutTerminalPeriod(language === "zh" ? alert.descriptionZh || alert.description : alert.descriptionEn || alert.description)}</p>
            <span>{t("开始", "Started")}: <time dateTime={alert.startedAt}>{formatLocalDateTime(alert.startedAt, language)}</time></span>
            {alert.resolvedAt ? <span>{t("恢复", "Recovered")}: <time dateTime={alert.resolvedAt}>{formatLocalDateTime(alert.resolvedAt, language)}</time></span> : null}
            {alert.acknowledgedAt ? <span>{t("确认", "Acknowledged")}: <time dateTime={alert.acknowledgedAt}>{formatLocalDateTime(alert.acknowledgedAt, language)}</time></span> : null}
          </div>
          <div className="alert-row__actions">{alert.status === "resolved" ? <Chip staticChip tone="success" icon="task_alt">{t("已恢复", "Recovered")}</Chip> : null}{!alert.acknowledged ? <Button variant="tonal" compact disabled={busy} onClick={() => void confirm(alert.episodeId)}>{t("确认", "Acknowledge")}</Button> : <Chip staticChip tone="success" icon="check">{t("已确认", "Acknowledged")}</Chip>}</div>
        </div>)}
        {loading ? <p className="muted">{t("正在读取告警记录", "Loading alert records")}</p> : loadError ? <div role="alert"><p>{t("告警记录加载失败，请重试。", "Unable to load alert records. Try again.")}</p><Button onClick={() => { setLoading(true); setRefresh((value) => value + 1); }}>{t("重试", "Retry")}</Button></div> : !visible.length ? <p className="muted">{filter === "pending" ? t("没有待确认的告警。", "No alerts need acknowledgement.") : t("暂无告警记录。", "No alert records yet.")}</p> : null}
      </div>
      {filter === "all" ? <RecordHistoryControls kind="alerts" expanded={expanded} loading={loading} total={result.total} page={result.page} totalPages={result.totalPages} onExpandedChange={(value) => { setExpanded(value); setPage(1); setLoading(true); }} /> : <div className="audit-controls"><div><strong>{t(`第 ${result.page}/${result.totalPages} 页`, `Page ${result.page} of ${result.totalPages}`)}</strong><span>{t(`总计 ${summary.pending} 条待处理`, `${summary.pending} pending alerts`)}</span></div></div>}
      {paginated && !loadError ? <RecordPagination page={result.page} totalPages={result.totalPages} onPageChange={(value) => { if (value !== page) { setPage(value); setLoading(true); } }} label={t("告警记录分页", "Alert record pagination")} /> : null}
    </Card>
  </div>;
}
