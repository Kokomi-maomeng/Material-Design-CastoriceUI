"use client";

import { useMemo, useState } from "react";
import { formatBytes, formatDate, percent } from "../../lib/format";
import type { Account, IntegrationStatus } from "../../lib/types";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { Progress } from "../ui/Progress";

interface AccountsPageProps {
  accounts: Account[];
  integration?: IntegrationStatus;
  onConfigure: () => void;
}

export function AccountsPage({ accounts, integration, onConfigure }: AccountsPageProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "disabled">("all");

  const filtered = useMemo(() => accounts.filter((account) => {
    const matchesSearch = `${account.name} ${account.email} ${account.note}`.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "all" || (filter === "active" ? account.status !== "disabled" : account.status === "disabled");
    return matchesSearch && matchesFilter;
  }), [accounts, filter, search]);

  return (
    <div className="page-content page-enter">
      <PageHeader
        eyebrow="访问控制"
        title="账号管理"
        description="集中管理代理账号、协议权限、流量额度与有效期。"
      />

      <IntegrationGate status={integration} name="账号统计数据源" description="账号清单、状态和额度来自受保护的服务器配置；协议适配器只补充核心实际返回的累计用量与在线计数。" onConfigure={onConfigure} />
      <div className="read-only-notice"><Icon name="info" size={20} /><span><strong>当前为只读同步</strong>账号的创建、密码和启停状态由代理核心认证配置决定；面板会在后端配置变更后自动更新，不展示无法真实执行的操作按钮。</span></div>

      <Card variant="outlined" className="table-panel">
        <div className="table-toolbar">
          <label className="search-field">
            <Icon name="search" size={20} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索账号、邮箱或备注" aria-label="搜索账号" />
            {search ? <button onClick={() => setSearch("")} aria-label="清空搜索"><Icon name="close" size={18} /></button> : null}
          </label>
          <div className="filter-chips" aria-label="账号状态筛选">
            <Chip selected={filter === "all"} onClick={() => setFilter("all")}>全部 {accounts.length}</Chip>
            <Chip selected={filter === "active"} onClick={() => setFilter("active")}>有效</Chip>
            <Chip selected={filter === "disabled"} onClick={() => setFilter("disabled")}>已禁用</Chip>
          </div>
        </div>

        <div className="responsive-table accounts-table">
          <table>
            <thead><tr><th>账号</th><th>状态</th><th>协议</th><th>核心累计流量</th><th>到期时间</th><th>备注</th></tr></thead>
            <tbody>
              {filtered.map((account) => {
                const usage = percent(account.usedBytes, account.quotaBytes);
                return (
                  <tr key={account.id}>
                    <td data-label="账号"><div className="account-cell"><span className="avatar avatar--small">{account.name.slice(0, 1).toUpperCase()}</span><div><strong>{account.name}</strong><span>{account.email}</span></div></div></td>
                    <td data-label="状态"><StatusChip status={account.status} devices={account.onlineDevices} /></td>
                    <td data-label="协议"><div className="protocol-list">{account.protocols.map((protocol) => <Chip staticChip key={protocol}>{protocol}</Chip>)}</div></td>
                    <td data-label="核心累计流量"><div className="quota-cell"><div><span>{formatBytes(account.usedBytes)}</span><small>/ 配置额度 {formatBytes(account.quotaBytes)}</small></div><Progress value={usage} tone={usage > 85 ? "warning" : "primary"} /></div></td>
                    <td data-label="到期时间"><span className={account.status === "expiring" ? "text-warning" : ""}>{formatDate(account.expiresAt)}</span></td>
                    <td data-label="备注"><span className="muted">{account.note || "—"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="table-footer"><span>显示 {filtered.length} / {accounts.length} 个账号</span><span>用量来自 Hysteria2 核心当前累计值，不自动等同于月度账期</span></div>
      </Card>
    </div>
  );
}

function StatusChip({ status, devices }: { status: Account["status"]; devices: number }) {
  if (status === "disabled") return <Chip staticChip tone="default" icon="pause_circle">已禁用</Chip>;
  if (status === "expiring") return <Chip staticChip tone="warning" icon="schedule">即将到期</Chip>;
  return <Chip staticChip tone="success" icon="fiber_manual_record">{devices > 0 ? `核心报告在线数 ${devices}` : "有效"}</Chip>;
}
