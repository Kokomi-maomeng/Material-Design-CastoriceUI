"use client";

import { useCallback, useEffect, useState } from "react";
import { useRecordHistory } from "../../lib/useRecordHistory";
import { fetchAudits } from "../../lib/api";
import { useI18n, withoutTerminalPeriod } from "../../lib/i18n";
import type { AuditEvent, AuditPageResponse, UiSettings } from "../../lib/types";
import { AnimatedRecords, RecordHistoryControls, RecordPagination } from "../ui/RecordHistory";
import { formatLocalDateTime, localTimeZone } from "../../lib/format";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

export function AuditPage({ retentionDays = 180 }: { retentionDays?: UiSettings["auditRetentionDays"] } = {}) {
  const { language, t } = useI18n();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"全部" | AuditEvent["category"]>("全部");
  const [querySearch, setQuerySearch] = useState("");
  useEffect(() => { const timer = window.setTimeout(() => setQuerySearch(search.trim()), 250); return () => window.clearTimeout(timer); }, [search]);
  const load = useCallback((page: number, signal: AbortSignal) => fetchAudits({ page, pageSize: 50, search: querySearch, category: category === "全部" ? "" : category, signal }), [category, querySearch]);
  const { result, items: events, expanded, toggleExpanded, setPage, loading, loadError, retry } = useRecordHistory<AuditEvent, AuditPageResponse>(JSON.stringify([category, querySearch]), load, retentionDays);
  const total = result?.total ?? 0, totalPages = result?.totalPages ?? 1, currentPage = result?.page ?? 1;

  return <div className="page-content page-enter">
    <PageHeader eyebrow={t("安全与追溯", "Security and traceability")} title={t("审计中心", "Audit center")} description={t(`时间按本地时区 ${localTimeZone()} 显示。`, `Times are shown in your local time zone: ${localTimeZone()}.`)} />
    <Card variant="outlined" className="table-panel audit-panel">
      <div className="table-toolbar table-toolbar--wrap">
        <label className="search-field"><Icon name="search" size={20} /><input maxLength={200} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={t("搜索操作、账号或 IP", "Search action, account, or IP")} aria-label={t("搜索审计记录", "Search audit records")} /></label>
        <div className="filter-chips">{(["全部", "认证", "账号", "配置", "系统"] as const).map((item) => <Chip key={item} selected={category === item} onClick={() => { setCategory(item); setPage(1); }}>{item === "全部" ? t("全部", "All") : item === "认证" ? t("认证", "Authentication") : item === "账号" ? t("账号", "Account") : item === "配置" ? t("配置", "Configuration") : t("系统", "System")}</Chip>)}</div>
      </div>
      {loadError ? <div className="record-load-error" role="alert"><p>{t("审计记录加载失败，请重试", "Unable to load audit records. Try again.")}</p><Button onClick={retry}>{t("重试", "Retry")}</Button></div> : null}
      <AnimatedRecords ready={Boolean(result)} itemCount={events.length} transitionKey={`${category}:${querySearch}:${currentPage}`}><div className={`responsive-table audit-table ${loading ? "is-loading" : ""}`} aria-busy={loading}><table><thead><tr><th>{t("时间", "Time")}</th><th>{t("操作", "Action")}</th><th>{t("类别", "Category")}</th><th>{t("操作者", "Actor")}</th><th>{t("来源 IP", "Source IP")}</th><th>{t("结果", "Result")}</th><th>{t("详情", "Details")}</th></tr></thead><tbody>
        {events.map((event) => <tr key={event.id}><td data-label={t("时间", "Time")}><time className="mono-time" dateTime={event.time}>{formatLocalDateTime(event.time, language)}</time></td><td data-label={t("操作", "Action")}><strong>{language === "zh" ? event.action : event.actionEn || event.action}</strong></td><td data-label={t("类别", "Category")}><Chip staticChip>{event.category === "认证" ? t("认证", "Authentication") : event.category === "账号" ? t("账号", "Account") : event.category === "配置" ? t("配置", "Configuration") : t("系统", "System")}</Chip></td><td data-label={t("操作者", "Actor")}><span className="actor"><Icon name={event.actor === "system" ? "smart_toy" : "person"} size={18} />{event.actor}</span></td><td data-label={t("来源 IP", "Source IP")}><code>{event.ip}</code></td><td data-label={t("结果", "Result")}><Chip staticChip tone={event.result === "成功" ? "success" : "danger"} icon={event.result === "成功" ? "check" : "close"}>{event.result === "成功" ? t("成功", "Success") : t("失败", "Failed")}</Chip></td><td data-label={t("详情", "Details")}><span className="muted">{withoutTerminalPeriod(language === "zh" ? event.detail : event.detailEn || event.detail)}</span></td></tr>)}
        {!loading && !loadError && events.length === 0 ? <tr><td colSpan={7}><span className="muted">{t("没有符合条件的审计记录。", "No audit records match these filters.")}</span></td></tr> : null}
      </tbody></table></div></AnimatedRecords>
      <RecordHistoryControls kind="audit" expanded={expanded} loading={loading} total={total} page={currentPage} totalPages={totalPages} onExpandedChange={toggleExpanded} />
      {expanded && !loadError ? <RecordPagination loading={loading} page={currentPage} totalPages={totalPages} onPageChange={setPage} label={t("审计日志分页", "Audit center pagination")} /> : null}
    </Card>
  </div>;
}
