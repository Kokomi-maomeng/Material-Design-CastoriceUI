"use client";

import { useMemo, useState } from "react";
import type { AuditEvent } from "../../lib/types";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

export function AuditPage({ events, onToast }: { events: AuditEvent[]; onToast: (message: string) => void }) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"全部" | AuditEvent["category"]>("全部");
  const visible = useMemo(() => events.filter((event) => (category === "全部" || event.category === category) && `${event.action} ${event.actor} ${event.ip} ${event.detail}`.toLowerCase().includes(search.toLowerCase())), [category, events, search]);
  return (
    <div className="page-content page-enter">
      <PageHeader eyebrow="安全与追溯" title="操作审计" description="记录登录、账号、配置、熔断与恢复等关键操作。" actions={<Button variant="outlined" icon="download" onClick={() => onToast("CSV 导出需要由后端按权限生成")}>导出 CSV</Button>} />
      <div className="audit-retention"><Icon name="policy" size={23} /><div><strong>审计保留策略</strong><span>默认保留 180 天，敏感字段在写入前应由后端脱敏。记录仅追加，不允许从面板删除。</span></div><Chip staticChip tone="success">策略生效</Chip></div>
      <Card variant="outlined" className="table-panel">
        <div className="table-toolbar table-toolbar--wrap"><label className="search-field"><Icon name="search" size={20} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索操作、账号或 IP" aria-label="搜索审计记录" /></label><div className="filter-chips">{(["全部", "认证", "账号", "配置", "系统"] as const).map((item) => <Chip key={item} selected={category === item} onClick={() => setCategory(item)}>{item}</Chip>)}</div></div>
        <div className="responsive-table audit-table"><table><thead><tr><th>时间</th><th>操作</th><th>类别</th><th>操作者</th><th>来源 IP</th><th>结果</th><th>详情</th></tr></thead><tbody>{visible.map((event) => <tr key={event.id}><td data-label="时间"><span className="mono-time">{event.time}</span></td><td data-label="操作"><strong>{event.action}</strong></td><td data-label="类别"><Chip staticChip>{event.category}</Chip></td><td data-label="操作者"><span className="actor"><Icon name={event.actor === "system" ? "smart_toy" : "person"} size={18} />{event.actor}</span></td><td data-label="来源 IP"><code>{event.ip}</code></td><td data-label="结果"><Chip staticChip tone={event.result === "成功" ? "success" : "danger"} icon={event.result === "成功" ? "check" : "close"}>{event.result}</Chip></td><td data-label="详情"><span className="muted">{event.detail}</span></td></tr>)}</tbody></table></div>
        <div className="table-footer"><span>显示最近 {visible.length} 条记录</span><span>所有地址均为文档示例网段</span></div>
      </Card>
    </div>
  );
}
