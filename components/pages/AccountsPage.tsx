"use client";

import { useMemo, useState } from "react";
import { formatBytes, formatDate, percent } from "../../lib/format";
import type { Account } from "../../lib/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Dialog } from "../ui/Dialog";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";
import { Progress } from "../ui/Progress";

interface AccountsPageProps {
  accounts: Account[];
  onCreate: (account: Account) => void;
  onToggle: (id: string) => void;
  onResetPassword: (account: Account) => void;
  onToast: (message: string) => void;
}

export function AccountsPage({ accounts, onCreate, onToggle, onResetPassword, onToast }: AccountsPageProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "disabled">("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [menuId, setMenuId] = useState<string | null>(null);

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
        actions={<Button icon="person_add" onClick={() => setCreateOpen(true)}>创建账号</Button>}
      />

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
            <thead><tr><th>账号</th><th>状态</th><th>协议</th><th>流量</th><th>到期时间</th><th>备注</th><th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>
              {filtered.map((account) => {
                const usage = percent(account.usedBytes, account.quotaBytes);
                return (
                  <tr key={account.id}>
                    <td data-label="账号"><div className="account-cell"><span className="avatar avatar--small">{account.name.slice(0, 1).toUpperCase()}</span><div><strong>{account.name}</strong><span>{account.email}</span></div></div></td>
                    <td data-label="状态"><StatusChip status={account.status} devices={account.onlineDevices} /></td>
                    <td data-label="协议"><div className="protocol-list">{account.protocols.map((protocol) => <Chip staticChip key={protocol}>{protocol}</Chip>)}</div></td>
                    <td data-label="流量"><div className="quota-cell"><div><span>{formatBytes(account.usedBytes)}</span><small>/ {formatBytes(account.quotaBytes)}</small></div><Progress value={usage} tone={usage > 85 ? "warning" : "primary"} /></div></td>
                    <td data-label="到期时间"><span className={account.status === "expiring" ? "text-warning" : ""}>{formatDate(account.expiresAt)}</span></td>
                    <td data-label="备注"><span className="muted">{account.note || "—"}</span></td>
                    <td className="action-cell">
                      <Button variant="text" icon="more_vert" aria-label={`管理 ${account.name}`} onClick={() => setMenuId(menuId === account.id ? null : account.id)} />
                      {menuId === account.id ? (
                        <div className="context-menu">
                          <button onClick={() => { onResetPassword(account); setMenuId(null); }}><Icon name="key" size={19} />重置密码</button>
                          <button onClick={() => { onToggle(account.id); setMenuId(null); }}><Icon name={account.status === "disabled" ? "play_circle" : "block"} size={19} />{account.status === "disabled" ? "启用账号" : "禁用账号"}</button>
                          <button onClick={() => { onToast("账号编辑将在接入后端后启用"); setMenuId(null); }}><Icon name="edit" size={19} />编辑信息</button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="table-footer"><span>显示 {filtered.length} / {accounts.length} 个账号</span><span>演示模式 · 操作仅在当前页面生效</span></div>
      </Card>

      <CreateAccountDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreate={(account) => { onCreate(account); setCreateOpen(false); }} />
    </div>
  );
}

function StatusChip({ status, devices }: { status: Account["status"]; devices: number }) {
  if (status === "disabled") return <Chip staticChip tone="default" icon="pause_circle">已禁用</Chip>;
  if (status === "expiring") return <Chip staticChip tone="warning" icon="schedule">即将到期</Chip>;
  return <Chip staticChip tone="success" icon="fiber_manual_record">{devices > 0 ? `${devices} 台在线` : "有效"}</Chip>;
}

function CreateAccountDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (account: Account) => void }) {
  const [name, setName] = useState("");
  const [quota, setQuota] = useState("100");
  const [expires, setExpires] = useState("2026-12-31");
  const [note, setNote] = useState("");
  const [protocols, setProtocols] = useState<Account["protocols"]>(["Hysteria2", "AnyTLS"]);

  const submit = () => {
    const quotaGb = Number(quota);
    if (!name.trim() || !Number.isFinite(quotaGb) || quotaGb <= 0 || protocols.length === 0 || !expires) return;
    onCreate({
      id: `acc-${Date.now()}`,
      name: name.trim(),
      email: `${name.trim().toLowerCase()}@example.test`,
      status: "active",
      protocols,
      usedBytes: 0,
      quotaBytes: quotaGb * 1024 ** 3,
      expiresAt: `${expires}T23:59:59+08:00`,
      note,
      onlineDevices: 0,
    });
    setName(""); setQuota("100"); setNote("");
  };

  return (
    <Dialog open={open} onClose={onClose} title="创建代理账号" description="凭据将由后端安全生成；前端不会保存明文密码。" actions={<><Button variant="text" onClick={onClose}>取消</Button><Button onClick={submit} disabled={!name.trim() || !Number.isFinite(Number(quota)) || Number(quota) <= 0 || protocols.length === 0 || !expires}>创建账号</Button></>}>
      <div className="form-grid">
        <label className="field field--wide"><span>账号名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：stelle" /></label>
        <label className="field"><span>流量额度（GB）</span><input type="number" min="1" value={quota} onChange={(event) => setQuota(event.target.value)} /></label>
        <label className="field"><span>到期日期</span><input type="date" value={expires} onChange={(event) => setExpires(event.target.value)} /></label>
        <fieldset className="field field--wide"><legend>允许协议</legend><div className="filter-chips">{(["Hysteria2", "AnyTLS", "VLESS", "TUIC"] as const).map((protocol) => <Chip key={protocol} selected={protocols.includes(protocol)} onClick={() => setProtocols((current) => current.includes(protocol) ? current.filter((item) => item !== protocol) : [...current, protocol])}>{protocol}</Chip>)}</div></fieldset>
        <label className="field field--wide"><span>备注</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="可选，仅管理员可见" rows={3} /></label>
      </div>
    </Dialog>
  );
}
