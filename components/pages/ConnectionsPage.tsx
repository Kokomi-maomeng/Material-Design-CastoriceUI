"use client";

import { useMemo, useState } from "react";
import { formatDuration, formatRate } from "../../lib/format";
import type { Connection, IntegrationStatus, Protocol } from "../../lib/types";
import { FeatureIntro } from "../setup/FeatureIntro";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

export function ConnectionsPage({ connections, now, onToast, integration, onConfigure }: { connections: Connection[]; now: number; onToast: (message: string) => void; integration?: IntegrationStatus; onConfigure: () => void }) {
  const [protocol, setProtocol] = useState<"all" | Protocol>("all");
  const [ipVersion, setIpVersion] = useState<"all" | 4 | 6>("all");
  const filtered = useMemo(() => connections.filter((item) => (protocol === "all" || item.protocol === protocol) && (ipVersion === "all" || item.ipVersion === ipVersion)), [connections, ipVersion, protocol]);
  const down = filtered.reduce((sum, item) => sum + item.downloadBps, 0);
  const up = filtered.reduce((sum, item) => sum + item.uploadBps, 0);

  return (
    <div className="page-content page-enter">
      <PageHeader eyebrow="实时会话" title="在线连接" description="查看各协议活跃客户端、来源地址、即时速率与连接时长。" actions={<Chip staticChip tone="success" icon="fiber_manual_record">数据流已连接</Chip>} />
      <IntegrationGate status={integration} name="实时连接采集" description="连接协议统计 API 后即可合并账号、来源 IP、速率和持续时间。" onConfigure={onConfigure} />
      <FeatureIntro items={[{ icon: "speed", title: "秒级速率", description: "自动换算 KB/s、MB/s 和 GB/s，避免固定单位误读。" }, { icon: "badge", title: "账号与协议", description: "将核心连接统一映射为一致的数据结构。" }, { icon: "public", title: "IPv4 / IPv6", description: "同时识别两类来源地址并提供筛选。" }]} />

      <section className="summary-strip">
        <div><span className="summary-icon"><Icon name="devices" /></span><p><b>{filtered.length}</b><span>在线设备</span></p></div>
        <div><span className="summary-icon"><Icon name="hub" /></span><p><b>{filtered.reduce((sum, item) => sum + item.connections, 0)}</b><span>并发连接</span></p></div>
        <div><span className="summary-icon summary-icon--down"><Icon name="south" /></span><p><b>{formatRate(down)}</b><span>实时下载</span></p></div>
        <div><span className="summary-icon summary-icon--up"><Icon name="north" /></span><p><b>{formatRate(up)}</b><span>实时上传</span></p></div>
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
            <thead><tr><th>协议</th><th>账号</th><th>来源 IP</th><th>连接数</th><th>下载速率</th><th>上传速率</th><th>持续时间</th><th><span className="sr-only">操作</span></th></tr></thead>
            <tbody>{filtered.map((item) => (
              <tr key={item.id}>
                <td data-label="协议"><Chip staticChip tone={item.protocol === "Hysteria2" ? "info" : "default"}>{item.protocol}</Chip></td>
                <td data-label="账号"><div className="account-inline"><span className="status-dot status-dot--online" /><strong>{item.account}</strong></div></td>
                <td data-label="来源 IP"><div className="ip-cell"><code>{item.sourceIp}</code><Chip staticChip>IPv{item.ipVersion}</Chip></div></td>
                <td data-label="连接数"><span className="connection-count">{item.connections}</span></td>
                <td data-label="下载速率"><span className="rate rate--down"><Icon name="south" size={17} />{formatRate(item.downloadBps)}</span></td>
                <td data-label="上传速率"><span className="rate rate--up"><Icon name="north" size={17} />{formatRate(item.uploadBps)}</span></td>
                <td data-label="持续时间"><span className="mono-time">{formatDuration((now - new Date(item.connectedAt).getTime()) / 1000)}</span></td>
                <td><Button variant="text" icon="more_vert" aria-label={`管理 ${item.account} 的连接`} onClick={() => onToast("断开连接等操作需要后端授权")} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="table-footer"><span>每秒更新 · 速率单位自动换算</span><span>来源 IP 为脱敏示例地址</span></div>
      </Card>
    </div>
  );
}
