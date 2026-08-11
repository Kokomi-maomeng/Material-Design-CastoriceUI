"use client";

import { useMemo, useState } from "react";
import { formatDuration, formatRate } from "../../lib/format";
import type { Connection, IntegrationStatus, Protocol } from "../../lib/types";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

export function ConnectionsPage({ connections, now, integration, onConfigure }: { connections: Connection[]; now: number; onToast: (message: string) => void; integration?: IntegrationStatus; onConfigure: () => void }) {
  const [protocol, setProtocol] = useState<"all" | Protocol>("all");
  const [ipVersion, setIpVersion] = useState<"all" | 4 | 6>("all");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const filtered = useMemo(() => connections.filter((item) => (protocol === "all" || item.protocol === protocol) && (ipVersion === "all" || item.ipVersion === ipVersion)), [connections, ipVersion, protocol]);
  const down = filtered.reduce((sum, item) => sum + (item.downloadBps ?? 0), 0);
  const up = filtered.reduce((sum, item) => sum + (item.uploadBps ?? 0), 0);
  const hasDownRates = filtered.some((item) => item.downloadBps !== null);
  const hasUpRates = filtered.some((item) => item.uploadBps !== null);
  const toggleExpanded = (id: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="page-content page-enter">
      <PageHeader eyebrow="协议快照" title="活动连接" description="按协议、账号和来源 IP 合并重复条目；展开后仅展示协议核心实际提供的目标和相邻快照计算速率。" actions={<Chip staticChip tone={integration?.status === "ready" ? "success" : "warning"} icon="schedule">5 秒轮询</Chip>} />
      <IntegrationGate status={integration} name="连接快照采集" description="Hysteria2 当前不提供来源 IP；AnyTLS 可展示真实来源与目标。未知字段不会补成 0 或虚构地址。" onConfigure={onConfigure} />

      <section className="summary-strip">
        <div><span className="summary-icon"><Icon name="group_work" /></span><p><b>{filtered.length}</b><span>聚合连接组</span></p></div>
        <div><span className="summary-icon"><Icon name="hub" /></span><p><b>{filtered.reduce((sum, item) => sum + item.connections, 0)}</b><span>活动子条目</span></p></div>
        {hasDownRates ? <div><span className="summary-icon summary-icon--down"><Icon name="south" /></span><p><b>{formatRate(down)}</b><span>已计算下载速率</span></p></div> : null}
        {hasUpRates ? <div><span className="summary-icon summary-icon--up"><Icon name="north" /></span><p><b>{formatRate(up)}</b><span>已计算上传速率</span></p></div> : null}
      </section>

      <Card variant="outlined" className="table-panel">
        <div className="table-toolbar table-toolbar--wrap">
          <div className="filter-chips">
            {(["all", "Hysteria2", "AnyTLS", "VLESS"] as const).map((item) => <Chip key={item} selected={protocol === item} onClick={() => setProtocol(item)}>{item === "all" ? "全部协议" : item}</Chip>)}
          </div>
          <div className="segmented-control" aria-label="IP 版本筛选">
            {(["all", 4, 6] as const).map((item) => <button className={ipVersion === item ? "is-selected" : ""} key={item} onClick={() => setIpVersion(item)}>{item === "all" ? "全部 IP" : `IPv${item}`}</button>)}
          </div>
        </div>
        <div className="responsive-table connections-table">
          <table>
            <thead><tr><th>协议</th><th>账号</th><th>来源 IP</th><th>活动条目</th>{hasDownRates ? <th>下载速率</th> : null}{hasUpRates ? <th>上传速率</th> : null}<th>持续时间</th><th aria-label="展开详情" /></tr></thead>
            <tbody>{filtered.flatMap((item) => {
              const details = item.details ?? [];
              const isExpanded = expanded.has(item.id);
              const columns = 6 + Number(hasDownRates) + Number(hasUpRates);
              return [<tr key={item.id}>
                <td data-label="协议"><Chip staticChip tone={item.protocol === "Hysteria2" ? "info" : "default"}>{item.protocol}</Chip></td>
                <td data-label="账号"><div className="account-inline"><span className="status-dot status-dot--online" /><strong>{item.account}</strong></div></td>
                <td data-label="来源 IP"><div className="ip-cell"><code>{item.sourceIp}</code>{item.ipVersion ? <Chip staticChip>IPv{item.ipVersion}</Chip> : null}</div></td>
                <td data-label="活动条目"><span className="connection-count">{item.connections}</span></td>
                {hasDownRates ? <td data-label="下载速率"><span className="rate rate--down"><Icon name="south" size={17} />{item.downloadBps === null ? "等待连续快照" : formatRate(item.downloadBps)}</span></td> : null}
                {hasUpRates ? <td data-label="上传速率"><span className="rate rate--up"><Icon name="north" size={17} />{item.uploadBps === null ? "等待连续快照" : formatRate(item.uploadBps)}</span></td> : null}
                <td data-label="持续时间"><span className="mono-time">{item.connectedAt ? formatDuration((now - new Date(item.connectedAt).getTime()) / 1000) : "核心未提供"}</span></td>
                <td>{details.length ? <button className="connection-expand" onClick={() => toggleExpanded(item.id)} aria-expanded={isExpanded} aria-label={isExpanded ? "收起连接详情" : "展开连接详情"}><Icon name={isExpanded ? "expand_less" : "expand_more"} /></button> : null}</td>
              </tr>, ...(isExpanded ? details.map((detail) => <tr className="connection-detail-row" key={`${item.id}-${detail.id}`}><td colSpan={columns}><div className="connection-detail"><code>{detail.destination}</code><span>{detail.connectedAt ? `已连接 ${formatDuration((now - new Date(detail.connectedAt).getTime()) / 1000)}` : "开始时间未提供"}</span>{detail.downloadBps !== null ? <span><Icon name="south" size={16} />{formatRate(detail.downloadBps)}</span> : null}{detail.uploadBps !== null ? <span><Icon name="north" size={16} />{formatRate(detail.uploadBps)}</span> : null}</div></td></tr>) : [])];
            })}</tbody>
          </table>
        </div>
        <div className="table-footer"><span>同协议、账号和来源 IP 自动合并 · 最早开始时间用于持续时长</span><span>速率由相邻真实累计字节快照计算；没有连续快照时整列隐藏</span></div>
      </Card>
    </div>
  );
}
