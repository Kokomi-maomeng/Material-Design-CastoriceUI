"use client";

import { AnimatedDetails } from "../ui/AnimatedDetails";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchAlerts } from "../../lib/api";
import { formatLocalDateTime, localDateBoundary } from "../../lib/format";
import { useI18n, withoutTerminalPeriod } from "../../lib/i18n";
import { useRecordHistory } from "../../lib/useRecordHistory";
import type { AlertItem, AlertPageResponse, AlertSummary, IntegrationStatus } from "../../lib/types";
import { IntegrationGate } from "../setup/IntegrationGate";
import { AnchoredPopover } from "../ui/AnchoredPopover";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { MaterialDatePicker } from "../ui/MaterialDatePicker";
import { AnimatedRecords, RecordHistoryControls, RecordPagination } from "../ui/RecordHistory";

type Filters = { from: string; to: string; status: "" | "active" | "recovered"; severity: "" | AlertItem["severity"] };
const emptyFilters: Filters = { from: "", to: "", status: "", severity: "" };

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
  const [scope, setScope] = useState<"pending" | "all">("pending");
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [draft, setDraft] = useState<Filters>(emptyFilters);
  const [filterOpen, setFilterOpen] = useState(false);
  const filterAnchor = useRef<HTMLSpanElement>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const refreshKey = useMemo(() => ({ alerts, refresh }), [alerts, refresh]);
  const load = useCallback((page: number, signal: AbortSignal) => fetchAlerts({ page, pageSize: 50, filter: scope, status: filters.status, severity: filters.severity, start: localDateBoundary(filters.from), end: localDateBoundary(filters.to, true), signal }), [scope, filters]);
  const records = useRecordHistory<AlertItem, AlertPageResponse>(JSON.stringify([scope, filters]), load, refreshKey);
  const { result, items, expanded, toggleExpanded, setPage, loading, loadError } = records;
  const summary = result?.summary ?? { pending: 0, critical: 0, warning: 0, info: 0 };
  const summaryCallback = useRef(onSummaryChange);
  useEffect(() => { summaryCallback.current = onSummaryChange; }, [onSummaryChange]);
  useEffect(() => { if (result) summaryCallback.current?.(result.summary); }, [result]);
  const closeFilter = useCallback(() => setFilterOpen(false), []);
  const apply = (value: Filters) => { setFilters(value); setDraft(value); setPage(1); };
  const selectScope = (value: typeof scope) => { setScope(value); setPage(1); };
  const invalidRange = Boolean(draft.from && draft.to && draft.from > draft.to || draft.from && !localDateBoundary(draft.from) || draft.to && !localDateBoundary(draft.to, true));
  const filterCount = Number(Boolean(filters.from || filters.to)) + Number(Boolean(filters.status)) + Number(Boolean(filters.severity));
  const confirm = async (episodeId?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      if (episodeId) await onAcknowledge(episodeId); else await onAcknowledgeAll();
      setRefresh((value) => value + 1);
    } catch { onToast(t("告警确认失败，请重试", "Unable to acknowledge the alert. Try again.")); }
    finally { setBusy(false); }
  };
  const severityName = (severity: AlertItem["severity"]) => severity === "critical" ? t("严重", "Critical") : severity === "warning" ? t("警告", "Warning") : t("提醒", "Info");
  const sourceName = (alert: AlertItem) => {
    if (alert.source === "Monitor evidence") return t("服务监控", "Service monitoring");
    return (language === "zh" ? alert.sourceZh : alert.sourceEn) || alert.source || t("系统监控", "System monitoring");
  };
  return <div className="page-content page-enter">
    <PageHeader eyebrow={t("主动监控", "Proactive monitoring")} title={t("告警中心", "Alerts")} />
    <IntegrationGate status={integration} name="告警规则" nameEn="Alert rules" description="设置流量、延迟和丢包阈值。" descriptionEn="Set traffic, latency, and packet-loss thresholds." onConfigure={onConfigure} />
    <section className="alert-summary">{(["critical", "warning", "info"] as const).map((severity) => <button type="button" className={`md-card md-card--filled alert-summary__button ${filters.severity === severity ? "is-selected" : ""}`} key={severity} aria-pressed={filters.severity === severity} onClick={() => apply({ ...filters, severity: filters.severity === severity ? "" : severity })}><span className={`alert-count alert-count--${severity}`}>{summary[severity]}</span><strong>{severityName(severity)}</strong></button>)}</section>
    <Card variant="outlined" className="alert-panel">
      <div className="table-toolbar"><div className="filter-chips">
        <Chip selected={scope === "pending"} onClick={() => selectScope("pending")}>{t("待处理", "Pending")} {summary.pending}</Chip>
        <Chip selected={scope === "all"} onClick={() => selectScope("all")}>{t("全部记录", "All records")}</Chip>
        <span ref={filterAnchor}><Button variant={filterCount ? "tonal" : "text"} compact icon="filter_list" aria-expanded={filterOpen} aria-haspopup="dialog" onClick={() => { setDraft(filters); setFilterOpen((value) => !value); }}>{t("筛选", "Filter")}{filterCount ? ` · ${filterCount}` : ""}</Button></span>
      </div><Button variant="text" compact icon="done_all" disabled={busy || loading || loadError || summary.pending === 0} onClick={() => void confirm()}>{t("全部确认", "Acknowledge all")}</Button></div>
      <AnchoredPopover open={filterOpen} anchorRef={filterAnchor} onClose={closeFilter} ariaLabel={t("筛选告警", "Filter alerts")} preferredWidth={440} placementPreference="vertical" className="alert-filter">
        <form onSubmit={(event) => { event.preventDefault(); if (!invalidRange) { apply(draft); closeFilter(); } }}>
          <fieldset><legend>{t("发生日期", "Start date")}</legend><div className="alert-filter__dates"><div className="field"><span>{t("从", "From")}</span><MaterialDatePicker portalClassName="alert-filter-calendar" allowEmpty ariaLabel={t("开始日期", "From date")} value={draft.from} onChange={(from) => setDraft({ ...draft, from })} /></div><span>—</span><div className="field"><span>{t("至", "To")}</span><MaterialDatePicker portalClassName="alert-filter-calendar" allowEmpty ariaLabel={t("结束日期", "To date")} value={draft.to} onChange={(to) => setDraft({ ...draft, to })} /></div></div>{invalidRange ? <p role="alert">{t("日期范围无效，请重新选择", "Choose a valid date range")}</p> : null}</fieldset>
          <fieldset><legend>{t("状态", "Status")}</legend><div className="filter-chips" role="group" aria-label={t("告警状态", "Alert status")}>{(["", "active", "recovered"] as const).map((status) => <Chip type="button" key={status} selected={draft.status === status} aria-pressed={draft.status === status} onClick={() => setDraft({ ...draft, status })}>{status === "" ? t("不限", "Any") : status === "active" ? t("正在发生", "Active") : t("已恢复待确认", "Recovered pending")}</Chip>)}</div></fieldset>
          <fieldset><legend>{t("级别", "Severity")}</legend><div className="filter-chips" role="group" aria-label={t("告警级别", "Alert severity")}>{(["", "critical", "warning", "info"] as const).map((severity) => <Chip type="button" key={severity} selected={draft.severity === severity} aria-pressed={draft.severity === severity} onClick={() => setDraft({ ...draft, severity })}>{severity ? severityName(severity) : t("不限", "Any")}</Chip>)}</div></fieldset>
          <div className="alert-filter__actions"><Button type="button" variant="text" onClick={() => setDraft(emptyFilters)}>{t("重置", "Reset")}</Button><Button type="submit" disabled={invalidRange}>{t("应用筛选", "Apply filters")}</Button></div>
        </form>
      </AnchoredPopover>
      <AnimatedRecords ready={Boolean(result)} itemCount={items.length} transitionKey={`${JSON.stringify([scope, filters])}:${result?.page ?? 1}`}>
        <div className={`alert-list ${loading && result ? "is-loading" : ""}`} aria-busy={loading}>
          {items.map((alert) => <div className={`alert-row alert-row--${alert.severity} ${alert.acknowledged ? "is-acknowledged" : ""}`} key={alert.episodeId}>
            <span className="alert-row__icon"><Icon name={alert.severity === "critical" ? "error" : alert.severity === "warning" ? "warning" : "info"} size={23} filled /></span>
            <div className="alert-row__content"><strong>{language === "zh" ? alert.titleZh || alert.title : alert.titleEn || alert.title}</strong><p>{withoutTerminalPeriod(language === "zh" ? alert.descriptionZh || alert.description : alert.descriptionEn || alert.description)}</p>
              <div className="alert-row__times"><span>{t("开始", "Started")} <time dateTime={alert.startedAt}>{formatLocalDateTime(alert.startedAt, language)}</time></span>
                {alert.resolvedAt ? <span>{t("恢复", "Recovered")} <time dateTime={alert.resolvedAt}>{formatLocalDateTime(alert.resolvedAt, language)}</time></span> : null}
                {alert.acknowledgedAt ? <span>{t("确认", "Acknowledged")} <time dateTime={alert.acknowledgedAt}>{formatLocalDateTime(alert.acknowledgedAt, language)}</time></span> : null}</div>
              <AnimatedDetails className="alert-record-details"><summary>{t("记录详情", "Record details")}</summary>
                <dl><div><dt>{t("监测来源", "Source")}</dt><dd>{sourceName(alert)}</dd></div>
                  <div><dt>{t("发生次数", "Occurrences")}</dt><dd>{Math.max(1, alert.repeatCount ?? 1)}</dd></div>
                  {alert.lastStartedAt && (alert.repeatCount ?? 1) > 1 ? <div><dt>{t("最近发生", "Last occurrence")}</dt><dd><time dateTime={alert.lastStartedAt}>{formatLocalDateTime(alert.lastStartedAt, language)}</time></dd></div> : null}</dl>
              </AnimatedDetails>
            </div>
            <div className="alert-row__actions">{alert.status === "resolved" ? <Chip staticChip tone="success" icon="task_alt">{t("已恢复", "Recovered")}</Chip> : null}{!alert.acknowledged ? <Button variant="tonal" compact disabled={busy || loading || loadError} onClick={() => void confirm(alert.episodeId)}>{t("确认", "Acknowledge")}</Button> : <Chip staticChip tone="success" icon="check">{t("已确认", "Acknowledged")}</Chip>}</div>
          </div>)}
          {loading && !result ? <p className="muted">{t("正在读取告警记录", "Loading alert records")}</p> : loadError ? <div role="alert"><p>{t("告警记录加载失败，请重试。", "Unable to load alert records. Try again.")}</p><Button onClick={() => setRefresh((value) => value + 1)}>{t("重试", "Retry")}</Button></div> : !items.length ? <p className="muted">{t("没有符合条件的告警。", "No alerts match these filters.")}</p> : null}
        </div>
      </AnimatedRecords>
      <RecordHistoryControls kind="alerts" expanded={expanded} loading={loading} total={result?.total ?? 0} page={result?.page ?? 1} totalPages={result?.totalPages ?? 1} onExpandedChange={toggleExpanded} />
      {expanded && !loadError ? <RecordPagination loading={loading} page={result?.page ?? 1} totalPages={result?.totalPages ?? 1} onPageChange={setPage} label={t("告警记录分页", "Alert record pagination")} /> : null}
    </Card>
  </div>;
}
