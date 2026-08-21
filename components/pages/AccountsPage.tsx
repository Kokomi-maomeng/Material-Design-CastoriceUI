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
  const filtered = useMemo(() => accounts.filter((account) => {
    const matchesSearch = `${account.name} ${account.email}`.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filter === "all" || (filter === "active" ? account.status !== "disabled" : account.status === "disabled");
    return matchesSearch && matchesStatus;
  }), [accounts, filter, search]);

  return <div className="page-content page-enter">
    <PageHeader eyebrow={t("账号", "Accounts")} title={t("账号状态", "Account status")} />
    <IntegrationGate status={integration} name="Hysteria2 账号统计" nameEn="Hysteria2 account statistics" description="连接 Traffic Stats API 并配置身份映射后显示账号用量。" descriptionEn="Connect the Traffic Stats API and configure identity mappings to show account usage." onConfigure={onConfigure} />
    <Card variant="outlined" className="table-panel">
      <div className="table-toolbar">
        <label className="search-field"><Icon name="search" size={20} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("搜索账号或邮箱", "Search account or email")} aria-label={t("搜索账号", "Search accounts")} />{search ? <button onClick={() => setSearch("")} aria-label={t("清空搜索", "Clear search")}><Icon name="close" size={18} /></button> : null}</label>
        <div className="filter-chips" aria-label={t("账号状态筛选", "Account status filter")}><Chip selected={filter === "all"} onClick={() => setFilter("all")}>{t("全部", "All")} {accounts.length}</Chip><Chip selected={filter === "active"} onClick={() => setFilter("active")}>{t("有效", "Active")}</Chip><Chip selected={filter === "disabled"} onClick={() => setFilter("disabled")}>{t("已禁用", "Disabled")}</Chip></div>
      </div>
      <div className="responsive-table accounts-table"><table>
        <thead><tr><th>{t("账号", "Account")}</th><th>{t("状态", "Status")}</th><th>{t("协议", "Protocols")}</th><th>{t("统一累计流量", "Unified cumulative usage")}</th><th>{t("到期时间", "Expires")}</th></tr></thead>
        <tbody>{filtered.map((account) => {
          const usage = percent(account.usedBytes, account.quotaBytes);
          return <tr key={account.id}>
            <td data-label={t("账号", "Account")}><div className="account-cell"><span className="avatar avatar--small">{account.name.slice(0, 1).toUpperCase()}</span><div><strong>{account.name}</strong><span>{account.email}</span></div></div></td>
            <td data-label={t("状态", "Status")}><StatusChip status={account.status} devices={account.onlineDevices} /></td>
            <td data-label={t("协议", "Protocols")}><div className="protocol-list">{account.protocols.map((protocol) => <Chip staticChip key={protocol}>{protocol}</Chip>)}</div></td>
            <td data-label={t("统一累计流量", "Unified cumulative usage")}><div className="quota-cell"><div><span>{formatDecimalBytes(account.usedBytes)}</span><small>{t(`/ 统一额度 ${formatDecimalBytes(account.quotaBytes)}`, `/ shared quota ${formatDecimalBytes(account.quotaBytes)}`)}</small></div><Progress value={usage} tone={usage > 85 ? "warning" : "primary"} /></div></td>
            <td data-label={t("到期时间", "Expires")}><span className={account.status === "expiring" ? "text-warning" : ""}>{formatDate(account.expiresAt)}</span></td>
          </tr>;
        })}</tbody>
      </table></div>
      <div className="table-footer"><span>{t(`显示 ${filtered.length} / ${accounts.length} 个账号`, `Showing ${filtered.length} of ${accounts.length} accounts`)}</span></div>
    </Card>
  </div>;
}

function StatusChip({ status, devices }: { status: Account["status"]; devices: number }) {
  const { t } = useI18n();
  if (status === "disabled") return <Chip staticChip tone="default" icon="pause_circle">{t("已禁用", "Disabled")}</Chip>;
  if (status === "expiring") return <Chip staticChip tone="warning" icon="schedule">{t("即将到期", "Expiring")}</Chip>;
  return <Chip staticChip tone="success" icon="fiber_manual_record">{devices > 0 ? t(`核心报告在线数 ${devices}`, `Core reports ${devices} online`) : t("有效", "Active")}</Chip>;
}
