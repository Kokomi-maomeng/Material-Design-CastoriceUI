"use client";

import { useMemo, useState } from "react";
import { useI18n } from "../../lib/i18n";
import type { AuditEvent, IntegrationStatus } from "../../lib/types";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

const AUDIT_ACTION_EN: Record<string, string> = {
  "更新流量额度": "Updated traffic quota", "更新面板设置": "Updated panel settings",
  "更新登录背景": "Updated sign-in background", "创建初始管理员": "Created initial administrator",
  "登录失败": "Sign-in failed", "登录成功": "Signed in", "退出登录": "Signed out",
  "完成初始化向导": "Completed initialization", "确认告警": "Acknowledged alert",
  "清理旧版接入密钥": "Removed legacy integration secret", "更新数据接入": "Updated data integration",
  "更新网络探测目标": "Updated network probe targets",
};

const AUDIT_DETAIL_EN: Record<string, string> = {
  "总流量额度已更新": "The total traffic quota was updated",
  "导航可见性设置已更新": "Navigation visibility settings were updated",
  "首次安全初始化已完成": "Secure first-run administrator creation completed",
  "用户名或密码错误": "The username or password was incorrect",
  "管理员会话已创建": "An administrator session was created",
  "管理员会话已注销": "The administrator session was invalidated",
  "必要的面板设置已确认": "Required panel settings were confirmed",
  "已从 SQLite 覆盖项中移除 v1.2 遗留的明文 Secret": "A legacy v1.2 plaintext Secret was removed from SQLite overrides",
};

function auditDetailEn(value: string) {
  if (AUDIT_DETAIL_EN[value]) return AUDIT_DETAIL_EN[value];
  return value.replace(/^(.+) 接入配置已更新$/, "$1 integration settings were updated")
    .replace(/^已保存 (\d+) 个探测目标$/, "$1 probe targets were saved")
    .replace(/^登录背景类型已设为 (.+)$/, "Sign-in background type set to $1")
    .replace(/^告警 (.+) 已确认$/, "Alert $1 was acknowledged");
}

function pageItems(current: number, total: number): Array<number | "ellipsis-left" | "ellipsis-right"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, 2, total - 1, total, current - 1, current, current + 1]);
  const sorted = [...pages].filter((page) => page > 0 && page <= total).sort((a, b) => a - b);
  const result: Array<number | "ellipsis-left" | "ellipsis-right"> = [];
  sorted.forEach((page, index) => {
    if (index && page - sorted[index - 1] > 1) result.push(page < current ? "ellipsis-left" : "ellipsis-right");
    result.push(page);
  });
  return result;
}

export function AuditPage({ events, integration, onConfigure }: { events: AuditEvent[]; integration?: IntegrationStatus; onConfigure: () => void }) {
  const { language, t } = useI18n();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"全部" | AuditEvent["category"]>("全部");
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [jump, setJump] = useState("");
  const filtered = useMemo(() => events.filter((event) =>
    (category === "全部" || event.category === category) &&
    `${event.action} ${event.actor} ${event.ip} ${event.detail}`.toLowerCase().includes(search.toLowerCase())), [category, events, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / 50));
  const currentPage = Math.min(page, totalPages);
  const visible = expanded ? filtered.slice((currentPage - 1) * 50, currentPage * 50) : filtered.slice(0, 30);
  const go = (next: number) => setPage(Math.min(totalPages, Math.max(1, next)));

  return <div className="page-content page-enter">
    <PageHeader eyebrow={t("安全与追溯", "Security and traceability")} title={t("操作审计", "Audit log")} description={t("记录登录、配置、告警确认与服务生命周期等关键操作。", "Record sign-ins, configuration, alert acknowledgements, and service lifecycle events.")} />
    <IntegrationGate status={integration} name="操作审计" nameEn="Audit log" description="记录配置更新、告警确认和服务生命周期事件。" descriptionEn="Record configuration changes, alert acknowledgements, and service lifecycle events." onConfigure={onConfigure} />
    <div className="audit-retention"><Icon name="policy" size={23} /><div><strong>{t("审计保留策略", "Audit retention")}</strong><span>{t("保留周期由服务器配置管理；密码、Token 和私钥不会写入详情，记录不能从面板删除。", "Retention is managed on the server. Passwords, tokens, and private keys are excluded, and records cannot be deleted from the panel.")}</span></div><Chip staticChip tone="success">{t("策略生效", "Policy active")}</Chip></div>
    <Card variant="outlined" className="table-panel">
      <div className="table-toolbar table-toolbar--wrap">
        <label className="search-field"><Icon name="search" size={20} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={t("搜索操作、账号或 IP", "Search action, account, or IP")} aria-label={t("搜索审计记录", "Search audit records")} /></label>
        <div className="filter-chips">{(["全部", "认证", "账号", "配置", "系统"] as const).map((item) => <Chip key={item} selected={category === item} onClick={() => { setCategory(item); setPage(1); }}>{item === "全部" ? t("全部", "All") : item === "认证" ? t("认证", "Authentication") : item === "账号" ? t("账号", "Account") : item === "配置" ? t("配置", "Configuration") : t("系统", "System")}</Chip>)}</div>
      </div>
      <div className="responsive-table audit-table"><table><thead><tr><th>{t("时间", "Time")}</th><th>{t("操作", "Action")}</th><th>{t("类别", "Category")}</th><th>{t("操作者", "Actor")}</th><th>{t("来源 IP", "Source IP")}</th><th>{t("结果", "Result")}</th><th>{t("详情", "Details")}</th></tr></thead><tbody>
        {visible.map((event) => <tr key={event.id}><td data-label={t("时间", "Time")}><span className="mono-time">{event.time}</span></td><td data-label={t("操作", "Action")}><strong>{language === "zh" ? event.action : AUDIT_ACTION_EN[event.action] || event.action}</strong></td><td data-label={t("类别", "Category")}><Chip staticChip>{event.category === "认证" ? t("认证", "Authentication") : event.category === "账号" ? t("账号", "Account") : event.category === "配置" ? t("配置", "Configuration") : t("系统", "System")}</Chip></td><td data-label={t("操作者", "Actor")}><span className="actor"><Icon name={event.actor === "system" ? "smart_toy" : "person"} size={18} />{event.actor}</span></td><td data-label={t("来源 IP", "Source IP")}><code>{event.ip}</code></td><td data-label={t("结果", "Result")}><Chip staticChip tone={event.result === "成功" ? "success" : "danger"} icon={event.result === "成功" ? "check" : "close"}>{event.result === "成功" ? t("成功", "Success") : t("失败", "Failed")}</Chip></td><td data-label={t("详情", "Details")}><span className="muted">{language === "zh" ? event.detail : auditDetailEn(event.detail)}</span></td></tr>)}
      </tbody></table></div>
      <div className="audit-controls">
        <div><strong>{expanded ? t(`第 ${currentPage}/${totalPages} 页`, `Page ${currentPage} of ${totalPages}`) : t(`默认显示最近 ${Math.min(30, filtered.length)} 条`, `Showing the latest ${Math.min(30, filtered.length)} by default`)}</strong><span>{t(`筛选结果共 ${filtered.length} 条`, `${filtered.length} filtered records`)}</span></div>
        {!expanded ? <Button variant="outlined" icon="unfold_more" onClick={() => { setExpanded(true); setPage(1); }}>{t("展开全部日志", "Show all logs")}</Button> : <Button variant="text" icon="unfold_less" onClick={() => { setExpanded(false); setPage(1); }}>{t("收起到最近 30 条", "Collapse to latest 30")}</Button>}
      </div>
      {expanded && totalPages > 1 ? <nav className="md-pagination" aria-label={t("审计日志分页", "Audit log pagination")}>
        <button onClick={() => go(currentPage - 1)} disabled={currentPage === 1} aria-label={t("上一页", "Previous page")}><Icon name="chevron_left" size={18} /></button>
        {pageItems(currentPage, totalPages).map((item) => typeof item === "number" ? <button key={item} className={currentPage === item ? "is-current" : ""} aria-current={currentPage === item ? "page" : undefined} onClick={() => go(item)}>{item}</button> : <span key={item}>…</span>)}
        <button onClick={() => go(currentPage + 1)} disabled={currentPage === totalPages} aria-label={t("下一页", "Next page")}><Icon name="chevron_right" size={18} /></button>
        <form onSubmit={(event) => { event.preventDefault(); go(Number(jump)); setJump(""); }}><label><span>{t("跳至", "Go to")}</span><input inputMode="numeric" pattern="[0-9]*" value={jump} onChange={(event) => setJump(event.target.value.replace(/\D/g, ""))} aria-label={t("输入页码", "Enter page number")} /><span>/ {totalPages}</span></label><Button type="submit" compact disabled={!jump}>{t("跳转", "Go")}</Button></form>
      </nav> : null}
      <div className="table-footer"><span>{t("展开后每页显示 50 条", "Expanded view shows 50 records per page")}</span><span>{t("敏感参数在写入前由后端移除", "Sensitive parameters are removed before storage")}</span></div>
    </Card>
  </div>;
}
