"use client";

import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { formatDate, formatDecimalBytes } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { PROTOCOL_NAMES, type Account, type IntegrationStatus, type Protocol, type Subscription } from "../../lib/types";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { AnimatedRecords, RecordHistoryControls, RecordPagination } from "../ui/RecordHistory";
import { useLocalRecordHistory } from "../../lib/useLocalRecordHistory";
import { AccountSubscriptions } from "./AccountSubscriptions";
import { AnchoredPopover } from "../ui/AnchoredPopover";

type FilterColumn = "name" | "protocol" | "status";
type SortColumn = "name" | "traffic" | "expiry";
type Direction = "ascending" | "descending";
type AccountSort = { column: SortColumn; direction: Direction };
type StatusFilter = "all" | Account["configuredStatus"];

function compareExpiry(left: Account, right: Account, direction: number) {
  const a = Date.parse(left.expiresAt), b = Date.parse(right.expiresAt);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number(Number.isNaN(a)) - Number(Number.isNaN(b));
  return (a - b) * direction;
}

export function AccountsPage({ accounts, unattributedBytes = 0, subscriptions = [], integration, onConfigure, onToast = () => undefined }: { accounts: Account[]; unattributedBytes?: number; subscriptions?: Subscription[]; integration?: IntegrationStatus; onConfigure: () => void; onToast?: (message: string) => void }) {
  const { language, t } = useI18n();
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const query = search.trim().normalize("NFKC").toLowerCase();
  const [status, setStatus] = useState<StatusFilter>("all");
  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [sort, setSort] = useState<AccountSort | null>(null);
  const [openFilter, setOpenFilter] = useState<FilterColumn | null>(null);
  const closeFilter = useCallback(() => setOpenFilter(null), []);
  const toggleFilter = (column: FilterColumn) => setOpenFilter((current) => current === column ? null : column);
  const toggleProtocol = (protocol: Protocol) => setProtocols((current) => current.includes(protocol) ? current.filter((item) => item !== protocol) : [...current, protocol]);
  const cycleSort = (column: "traffic" | "expiry", first: Direction) => setSort((current) => {
    if (current?.column !== column) return { column, direction: first };
    if (current.direction === first) return { column, direction: first === "ascending" ? "descending" : "ascending" };
    return null;
  });
  const sortDirection = (column: SortColumn) => sort?.column === column ? sort.direction : undefined;
  const filtered = useMemo(() => {
    const matching = accounts.filter((account) => {
      const matchesSearch = !query || [account.name, account.email].some((value) => value.normalize("NFKC").toLowerCase().includes(query));
      return matchesSearch && (status === "all" || status === account.configuredStatus)
        && (!protocols.length || account.protocols.some((protocol) => protocols.includes(protocol)));
    });
    if (!sort) return matching;
    const direction = sort.direction === "ascending" ? 1 : -1;
    if (sort.column === "traffic") return matching.sort((left, right) => (left.usedBytes - right.usedBytes) * direction);
    if (sort.column === "expiry") return matching.sort((left, right) => compareExpiry(left, right, direction));
    const collator = new Intl.Collator(language, { numeric: true, sensitivity: "base" });
    return matching.sort((left, right) => collator.compare(left.name, right.name) * direction);
  }, [accounts, language, protocols, query, sort, status]);

  const history = useLocalRecordHistory(filtered, JSON.stringify([query, status, protocols, sort]));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [subscriptionOpen, setSubscriptionOpen] = useState(false);
  const selectedAccount = accounts.find((account) => account.id === selectedId);
  const statusOptions = [
    { value: "all", label: t("全部", "All") },
    { value: "active", label: t("账号启用", "Account enabled") },
    { value: "disabled", label: t("账号禁用", "Account disabled") },
    { value: "unknown", label: t("账号状态未知", "Account status unknown") },
  ] as const;

  return <div className="page-content page-enter">
    <PageHeader eyebrow={t("账号状态", "Account status")} title={t("账号管理", "Account management")} />
    <IntegrationGate status={integration} name="Hysteria2 账号统计" nameEn="Hysteria2 account statistics" description="连接 Traffic Stats API 并配置身份映射后显示账号用量。" descriptionEn="Connect the Traffic Stats API and configure identity mappings to show account usage." onConfigure={onConfigure} />
    <Card variant="outlined" className="table-panel">
      <AnimatedRecords itemCount={history.items.length} transitionKey="accounts"><div className="responsive-table accounts-table"><table>
        <thead><tr>
          <th scope="col" aria-sort={sortDirection("name")}><span className="account-column">{t("账号", "Account")}
            <AccountColumnFilter label={t("搜索与排序账号", "Search and sort accounts")} active={Boolean(query || sortDirection("name"))} open={openFilter === "name"} onToggle={() => toggleFilter("name")} onClose={closeFilter}>
              <div className="search-field">
                <label className="search-field__label"><Icon name="search" size={20} /><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("搜索账号或邮箱", "Search account or email")} aria-label={t("搜索账号", "Search accounts")} /></label>
                {search ? <button type="button" onClick={() => { setSearch(""); searchRef.current?.focus(); }} aria-label={t("清空搜索", "Clear search")}><Icon name="close" size={18} /></button> : null}
              </div>
              <div className="filter-chips" role="group" aria-label={t("账号排序", "Account order")}>
                <Chip selected={!sort} aria-pressed={!sort} onClick={() => setSort(null)}>{t("默认", "Default")}</Chip>
                <Chip selected={sortDirection("name") === "ascending"} aria-pressed={sortDirection("name") === "ascending"} onClick={() => setSort({ column: "name", direction: "ascending" })}>A–Z</Chip>
                <Chip selected={sortDirection("name") === "descending"} aria-pressed={sortDirection("name") === "descending"} onClick={() => setSort({ column: "name", direction: "descending" })}>Z–A</Chip>
              </div>
            </AccountColumnFilter>
          </span></th>
          <th scope="col"><span className="account-column">{t("账号状态", "Account status")}
            <AccountColumnFilter label={t("筛选账号状态", "Filter account status")} active={status !== "all"} open={openFilter === "status"} onToggle={() => toggleFilter("status")} onClose={closeFilter}>
              <div className="filter-chips">{statusOptions.map(({ value, label }) => <Chip key={value} selected={status === value} aria-pressed={status === value} onClick={() => setStatus(value)}>{label}</Chip>)}</div>
            </AccountColumnFilter>
          </span></th>
          <th scope="col"><span className="account-column">{t("协议", "Protocols")}
            <AccountColumnFilter label={t("筛选协议", "Filter protocols")} active={protocols.length > 0} open={openFilter === "protocol"} onToggle={() => toggleFilter("protocol")} onClose={closeFilter}>
              <div className="filter-chips">
                <Chip selected={!protocols.length} aria-pressed={!protocols.length} onClick={() => setProtocols([])}>{t("全部", "All")}</Chip>
                {PROTOCOL_NAMES.map((protocol) => <Chip key={protocol} selected={protocols.includes(protocol)} aria-pressed={protocols.includes(protocol)} onClick={() => toggleProtocol(protocol)}>{protocol}</Chip>)}
              </div>
            </AccountColumnFilter>
          </span></th>
          <AccountSortHeader label={t("累计流量", "Cumulative traffic")} action={t("按累计流量排序", "Sort by cumulative traffic")} direction={sortDirection("traffic")} onClick={() => cycleSort("traffic", "descending")} />
          <AccountSortHeader label={t("到期时间", "Expires")} action={t("按到期时间排序", "Sort by expiry date")} direction={sortDirection("expiry")} onClick={() => cycleSort("expiry", "ascending")} />
        </tr></thead>
        <tbody>
          <tr className="account-unattributed">
            <td><div className="account-cell"><span className="avatar avatar--small"><Icon name="data_usage" size={18} /></span><span><strong>{t("未归属", "Unattributed")}</strong></span></div></td>
            <td className="account-unattributed__blank" />
            <td className="account-unattributed__blank" />
            <td data-label={t("累计流量", "Cumulative traffic")}><div className="quota-cell"><div><span>{formatDecimalBytes(unattributedBytes)}</span></div></div></td>
            <td className="account-unattributed__blank" />
          </tr>
        {history.items.map((account) => {
          return <tr key={account.id}>
            <td data-label={t("账号", "Account")}><button className="account-cell account-subscription-trigger" onClick={() => { setSelectedId(account.id); setSubscriptionOpen(true); }} aria-label={t(`查看 ${account.name} 的订阅`, `View ${account.name} subscriptions`)} aria-haspopup="dialog"><span className="avatar avatar--small">{account.name.slice(0, 1).toUpperCase()}</span><span><strong>{account.name}</strong><span>{account.email}</span></span><Icon name="chevron_right" size={20} /></button></td>
            <td data-label={t("账号状态", "Account status")}><StatusChips account={account} /></td>
            <td data-label={t("协议", "Protocols")}><div className="protocol-list">{account.protocols.map((protocol) => <Chip staticChip key={protocol}>{protocol}</Chip>)}</div></td>
            <td data-label={t("累计流量", "Cumulative traffic")}><div className="quota-cell"><div><span>{formatDecimalBytes(account.usedBytes)}</span>{account.usageSource !== "protocolCounter" ? <small>{t("尚未映射协议身份", "No protocol identity mapping")}</small> : null}</div></div></td>
            <td data-label={t("到期时间", "Expires")}><span className={account.expiryStatus === "expiring" || account.expiryStatus === "expired" ? "text-warning" : ""}>{account.expiresAt ? formatDate(account.expiresAt, language) : t("未登记", "Not registered")}</span></td>
          </tr>;
        })}{filtered.length === 0 ? <tr><td colSpan={5}>{t("没有符合条件的账号。", "No matching accounts.")}</td></tr> : null}</tbody>
      </table></div></AnimatedRecords>
      <RecordHistoryControls kind="accounts" expanded={history.expanded} loading={false} total={filtered.length} page={history.page} totalPages={history.totalPages} onExpandedChange={history.toggleExpanded} />
      {history.expanded ? <RecordPagination page={history.page} totalPages={history.totalPages} onPageChange={history.setPage} label={t("账号分页", "Account pagination")} /> : null}
    </Card>
    {selectedAccount ? <AccountSubscriptions key={selectedAccount.id} open={subscriptionOpen} account={selectedAccount} subscriptions={subscriptions} onClose={() => setSubscriptionOpen(false)} onToast={onToast} /> : null}
  </div>;
}

function AccountColumnFilter({ label, active, open, onToggle, onClose, children }: { label: string; active: boolean; open: boolean; onToggle: () => void; onClose: () => void; children: ReactNode }) {
  const anchor = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={anchor} type="button" className={`account-column__action ${active ? "is-active" : ""}`} aria-label={label} title={label} aria-haspopup="dialog" aria-expanded={open} onClick={onToggle}><Icon name={active ? "filter_alt" : "filter_list"} size={18} /></button>
    <AnchoredPopover anchorRef={anchor} open={open} onClose={onClose} ariaLabel={label} preferredWidth={320} placementPreference="vertical" className="account-column-popover" focusOnOpen>
      {children}
    </AnchoredPopover>
  </>;
}

function AccountSortHeader({ label, action, direction, onClick }: { label: string; action: string; direction?: Direction; onClick: () => void }) {
  const icon = direction === "ascending" ? "arrow_upward" : direction === "descending" ? "arrow_downward" : "unfold_more";
  return <th scope="col" aria-sort={direction}><span className="account-column">{label}
    <button type="button" className={`account-column__action ${direction ? "is-active" : ""}`} aria-label={action} title={action} onClick={onClick}><Icon name={icon} size={18} /></button>
  </span></th>;
}

function StatusChips({ account }: { account: Account }) {
  const { t } = useI18n();
  return <div className="protocol-list">
    <Chip staticChip tone={account.configuredStatus === "disabled" ? "default" : account.configuredStatus === "active" ? "info" : "warning"} icon={account.configuredStatus === "disabled" ? "pause_circle" : "settings"}>{account.configuredStatus === "disabled" ? t("账号禁用", "Account disabled") : account.configuredStatus === "active" ? t("账号启用", "Account enabled") : t("账号状态未知", "Account status unknown")}</Chip>
    {account.expiryStatus === "expired" ? <Chip staticChip tone="danger" icon="event_busy">{t("登记日期已过期", "Recorded date expired")}</Chip> : account.expiryStatus === "expiring" ? <Chip staticChip tone="warning" icon="schedule">{t("登记日期临期", "Recorded date expiring")}</Chip> : null}
    <Chip staticChip tone={account.coreEvidence === "observed" ? "success" : "default"} icon={account.coreEvidence === "observed" ? "visibility" : "help"}>{account.coreEvidence === "observed" ? t(`核心观测到身份 · 在线数 ${account.onlineDevices}`, `Identity observed by core · online ${account.onlineDevices}`) : account.coreEvidence === "notObserved" ? t("核心当前未观测到身份", "Identity not currently observed") : account.coreEvidence === "unavailable" ? t("核心证据不可用", "Core evidence unavailable") : t("未配置身份映射", "No identity mapping")}</Chip>
  </div>;
}
