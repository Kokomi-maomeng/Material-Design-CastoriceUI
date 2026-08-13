"use client";

import { useMemo, useState } from "react";
import { formatDate, formatDecimalBytes, percent } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { Account, IntegrationStatus } from "../../lib/types";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { Progress } from "../ui/Progress";

export function AccountsPage({ accounts, integration, onConfigure }: { accounts: Account[]; integration?: IntegrationStatus; onConfigure: () => void }) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "disabled">("all");
  const filtered = useMemo(() => accounts.filter((account) => `${account.name} ${account.email} ${account.note}`.toLowerCase().includes(search.toLowerCase()) && (filter === "all" || (filter === "active" ? account.status !== "disabled" : account.status === "disabled"))), [accounts, filter, search]);

  return <div className="page-content page-enter">
    <PageHeader eyebrow={t("只读观察", "Read-only observation")} title={t("账号状态", "Account status")} description={t("查看服务器配置账号、真实核心累计用量、统一流量额度与有效期；本页不修改代理核心。", "Review server-configured accounts, real core cumulative usage, the shared traffic quota, and expiry dates. This page does not modify the proxy core.")} />
    <IntegrationGate status={integration} name="账号统计数据源" nameEn="Account statistics" description="账号清单和状态来自受保护的服务器配置；累计用量与在线数只使用核心实际返回的数据。" descriptionEn="Account lists and states come from protected server configuration. Cumulative usage and online counts use only data returned by the core." onConfigure={onConfigure} />
    <div className="read-only-notice"><Icon name="info" size={20} /><span><strong>{t("当前为只读同步", "Read-only synchronization")}</strong>{t("账号创建、密码和启停由代理核心认证配置管理；本页不会展示无法真实执行的操作。", "Account creation, passwords, and state are managed by the proxy core's authentication configuration. This page does not offer actions it cannot truly execute.")}</span></div>
    <Card variant="outlined" className="table-panel"><div className="table-toolbar"><label className="search-field"><Icon name="search" size={20} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("搜索账号、邮箱或备注", "Search account, email, or note")} aria-label={t("搜索账号", "Search accounts")} />{search ? <button onClick={() => setSearch("")} aria-label={t("清空搜索", "Clear search")}><Icon name="close" size={18} /></button> : null}</label><div className="filter-chips" aria-label={t("账号状态筛选", "Account status filter")}><Chip selected={filter === "all"} onClick={() => setFilter("all")}>{t("全部", "All")} {accounts.length}</Chip><Chip selected={filter === "active"} onClick={() => setFilter("active")}>{t("有效", "Active")}</Chip><Chip selected={filter === "disabled"} onClick={() => setFilter("disabled")}>{t("已禁用", "Disabled")}</Chip></div></div>
      <div className="responsive-table accounts-table"><table><thead><tr><th>{t("账号", "Account")}</th><th>{t("状态", "Status")}</th><th>{t("协议", "Protocols")}</th><th>{t("核心累计流量", "Core cumulative usage")}</th><th>{t("到期时间", "Expires")}</th><th>{t("备注", "Note")}</th></tr></thead><tbody>{filtered.map((account) => { const usage = percent(account.usedBytes, account.quotaBytes); return <tr key={account.id}><td data-label={t("账号", "Account")}><div className="account-cell"><span className="avatar avatar--small">{account.name.slice(0, 1).toUpperCase()}</span><div><strong>{account.name}</strong><span>{account.email}</span></div></div></td><td data-label={t("状态", "Status")}><StatusChip status={account.status} devices={account.onlineDevices} /></td><td data-label={t("协议", "Protocols")}><div className="protocol-list">{account.protocols.map((protocol) => <Chip staticChip key={protocol}>{protocol}</Chip>)}</div></td><td data-label={t("核心累计流量", "Core cumulative usage")}><div className="quota-cell"><div><span>{formatDecimalBytes(account.usedBytes)}</span><small>{t(`/ 统一额度 ${formatDecimalBytes(account.quotaBytes)}`, `/ shared quota ${formatDecimalBytes(account.quotaBytes)}`)}</small></div><Progress value={usage} tone={usage > 85 ? "warning" : "primary"} /></div></td><td data-label={t("到期时间", "Expires")}><span className={account.status === "expiring" ? "text-warning" : ""}>{formatDate(account.expiresAt)}</span></td><td data-label={t("备注", "Note")}><span className="muted">{account.note || "—"}</span></td></tr>; })}</tbody></table></div>
      <div className="table-footer"><span>{t(`显示 ${filtered.length} / ${accounts.length} 个账号`, `Showing ${filtered.length} of ${accounts.length} accounts`)}</span><span>{t("用量来自 Hysteria2 核心当前累计值；统一额度与总览设置完全一致", "Usage comes from current Hysteria2 core totals. The shared quota exactly matches the overview setting.")}</span></div>
    </Card>
  </div>;
}

function StatusChip({ status, devices }: { status: Account["status"]; devices: number }) {
  const { t } = useI18n();
  if (status === "disabled") return <Chip staticChip tone="default" icon="pause_circle">{t("已禁用", "Disabled")}</Chip>;
  if (status === "expiring") return <Chip staticChip tone="warning" icon="schedule">{t("即将到期", "Expiring")}</Chip>;
  return <Chip staticChip tone="success" icon="fiber_manual_record">{devices > 0 ? t(`核心报告在线数 ${devices}`, `Core reports ${devices} online`) : t("有效", "Active")}</Chip>;
}
