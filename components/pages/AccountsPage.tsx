"use client";

import { useMemo, useState } from "react";
import { formatDate, formatDecimalBytes } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { Account, IntegrationStatus, Subscription } from "../../lib/types";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { AnimatedRecords, RecordHistoryControls, RecordPagination } from "../ui/RecordHistory";
import { useLocalRecordHistory } from "../../lib/useLocalRecordHistory";
import { AccountSubscriptions } from "./AccountSubscriptions";

export function AccountsPage({ accounts, subscriptions = [], integration, onConfigure, onToast = () => undefined }: { accounts: Account[]; subscriptions?: Subscription[]; integration?: IntegrationStatus; onConfigure: () => void; onToast?: (message: string) => void }) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "disabled">("all");
  const filtered = useMemo(() => accounts.filter((account) => {
    const matchesSearch = `${account.name} ${account.email}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filter === "all" || (filter === "active" ? account.configuredStatus === "active" : account.configuredStatus === "disabled");
    return matchesSearch && matchesStatus;
  }), [accounts, filter, search]);

  const history = useLocalRecordHistory(filtered, `${filter}:${search}`);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedAccount = accounts.find((account) => account.id === selectedId);

  return <div className="page-content page-enter">
    <PageHeader eyebrow={t("管理账号", "Managed accounts")} title={t("账号状态", "Account status")} />
    <IntegrationGate status={integration} name="Hysteria2 账号统计" nameEn="Hysteria2 account statistics" description="连接 Traffic Stats API 并配置身份映射后显示账号用量。" descriptionEn="Connect the Traffic Stats API and configure identity mappings to show account usage." onConfigure={onConfigure} />
    <Card variant="outlined" className="table-panel">
      <div className="table-toolbar">
        <label className="search-field"><Icon name="search" size={20} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("搜索账号或邮箱", "Search account or email")} aria-label={t("搜索账号", "Search accounts")} />{search ? <button onClick={() => setSearch("")} aria-label={t("清空搜索", "Clear search")}><Icon name="close" size={18} /></button> : null}</label>
        <div className="filter-chips" aria-label={t("账号状态筛选", "Account status filter")}><Chip selected={filter === "all"} onClick={() => setFilter("all")}>{t("全部", "All")} {accounts.length}</Chip><Chip selected={filter === "active"} onClick={() => setFilter("active")}>{t("账号启用", "Account enabled")}</Chip><Chip selected={filter === "disabled"} onClick={() => setFilter("disabled")}>{t("账号禁用", "Account disabled")}</Chip></div>
      </div>
      <AnimatedRecords itemCount={history.items.length} transitionKey={`${filter}:${search}:${history.page}`}><div className="responsive-table accounts-table"><table>
        <thead><tr><th>{t("管理账号", "Managed account")}</th><th>{t("状态", "Status")}</th><th>{t("协议", "Protocols")}</th><th>{t("映射协议累计流量", "Mapped protocol usage")}</th><th>{t("到期时间", "Expires")}</th></tr></thead>
        <tbody>{history.items.map((account) => {
          return <tr key={account.id}>
            <td data-label={t("管理账号", "Managed account")}><button className="account-cell account-subscription-trigger" onClick={() => setSelectedId(account.id)} aria-label={t(`查看 ${account.name} 的订阅`, `View ${account.name} subscriptions`)} aria-haspopup="dialog"><span className="avatar avatar--small">{account.name.slice(0, 1).toUpperCase()}</span><span><strong>{account.name}</strong><span>{account.email}</span></span><Icon name="chevron_right" size={20} /></button></td>
            <td data-label={t("状态", "Status")}><StatusChips account={account} /></td>
            <td data-label={t("协议", "Protocols")}><div className="protocol-list">{account.protocols.map((protocol) => <Chip staticChip key={protocol}>{protocol}</Chip>)}</div></td>
            <td data-label={t("映射协议累计流量", "Mapped protocol usage")}><div className="quota-cell"><div><span>{formatDecimalBytes(account.usedBytes)}</span>{account.usageSource !== "protocolCounter" ? <small>{t("尚未映射协议身份", "No protocol identity mapping")}</small> : null}</div></div></td>
            <td data-label={t("到期时间", "Expires")}><span className={account.expiryStatus === "expiring" || account.expiryStatus === "expired" ? "text-warning" : ""}>{account.expiresAt ? formatDate(account.expiresAt) : t("未登记", "Not registered")}</span></td>
          </tr>;
        })}{filtered.length === 0 ? <tr><td colSpan={5}>{t("没有符合条件的账号。", "No matching accounts.")}</td></tr> : null}</tbody>
      </table></div></AnimatedRecords>
      <RecordHistoryControls kind="accounts" expanded={history.expanded} loading={false} total={filtered.length} page={history.page} totalPages={history.totalPages} onExpandedChange={history.toggleExpanded} />
      {history.expanded ? <RecordPagination page={history.page} totalPages={history.totalPages} onPageChange={history.setPage} label={t("账号分页", "Account pagination")} /> : null}
    </Card>
    {selectedAccount ? <AccountSubscriptions key={selectedAccount.id} account={selectedAccount} subscriptions={subscriptions} onClose={() => setSelectedId(null)} onToast={onToast} /> : null}
  </div>;
}

function StatusChips({ account }: { account: Account }) {
  const { t } = useI18n();
  return <div className="protocol-list">
    <Chip staticChip tone={account.configuredStatus === "disabled" ? "default" : account.configuredStatus === "active" ? "info" : "warning"} icon={account.configuredStatus === "disabled" ? "pause_circle" : "settings"}>{account.configuredStatus === "disabled" ? t("账号禁用", "Account disabled") : account.configuredStatus === "active" ? t("账号启用", "Account enabled") : t("账号状态未知", "Account status unknown")}</Chip>
    {account.expiryStatus === "expired" ? <Chip staticChip tone="danger" icon="event_busy">{t("登记日期已过期", "Recorded date expired")}</Chip> : account.expiryStatus === "expiring" ? <Chip staticChip tone="warning" icon="schedule">{t("登记日期临期", "Recorded date expiring")}</Chip> : null}
    <Chip staticChip tone={account.coreEvidence === "observed" ? "success" : "default"} icon={account.coreEvidence === "observed" ? "visibility" : "help"}>{account.coreEvidence === "observed" ? t(`核心观测到身份 · 在线数 ${account.onlineDevices}`, `Identity observed by core · online ${account.onlineDevices}`) : account.coreEvidence === "notObserved" ? t("核心当前未观测到身份", "Identity not currently observed") : account.coreEvidence === "unavailable" ? t("核心证据不可用", "Core evidence unavailable") : t("未配置身份映射", "No identity mapping")}</Chip>
  </div>;
}
