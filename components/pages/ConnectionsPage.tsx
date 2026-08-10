"use client";

import { useMemo, useState } from "react";
import { formatDuration, formatRate } from "../../lib/format";
import type { Connection, IntegrationStatus, Protocol } from "../../lib/types";
import { FeatureIntro } from "../setup/FeatureIntro";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

export function ConnectionsPage({ connections, now, integration, onConfigure }: { connections: Connection[]; now: number; onToast: (message: string) => void; integration?: IntegrationStatus; onConfigure: () => void }) {
  const [protocol, setProtocol] = useState<"all" | Protocol>("all");
  const [ipVersion, setIpVersion] = useState<"all" | 4 | 6>("all");
  const filtered = useMemo(() => connections.filter((item) => (protocol === "all" || item.protocol === protocol) && (ipVersion === "all" || item.ipVersion === ipVersion)), [connections, ipVersion, protocol]);
  const down = filtered.reduce((sum, item) => sum + (item.downloadBps ?? 0), 0);
  const up = filtered.reduce((sum, item) => sum + (item.uploadBps ?? 0), 0);
  const hasDownRates = filtered.length > 0 && filtered.every((item) => item.downloadBps !== null);
  const hasUpRates = filtered.length > 0 && filtered.every((item) => item.uploadBps !== null);

  return (
    <div className="page-content page-enter">
      <PageHeader eyebrow="协议快照" title="活动连接条目" description="每 5 秒读取一次后端快照；来源地址、速率和开始时间仅在协议核心实际提供时显示。" actions={<Chip staticChip tone={integration?.status === "ready" ? "success" : "warning"} icon="schedule">5 秒轮询</Chip>} />
      <IntegrationGate status={integration} name="连接快照采集" description="连接协议统计 API 后，页面按核心实际返回字段展示账号、来源 IP、累计字节和连接时间。" onConfigure={onConfigure} />
      <FeatureIntro items={[{ icon: "speed", title: "不推算未知速率", description: "核心没有返回速率时明确显示“未提供”，不会用 0 冒充实时值。" }, { icon: "badge", title: "账号与协议", description: "活动流或连接条目不等同于独立设备数量。" }, { icon: "public", title: "来源地址可缺失", description: "仅显示协议核心实际返回的 IPv4 / IPv6 地址。" }]} />

      <section className="summary-strip">
        <div><span className="summary-icon"><Icon name="list_alt" /></span><p><b>{filtered.length}</b><span>活动条目</span></p></div>
        <div><span className="summary-icon"><Icon name="hub" /></span><p><b>{filtered.reduce((sum, item) => sum + item.connections, 0)}</b><span>核心报告连接数</span></p></div>
        <div><span className="summary-icon summary-icon--down"><Icon name="south" /></span><p><b>{hasDownRates ? formatRate(down) : "未完整提供"}</b><span>下载速率</span></p></div>
        <div><span className="summary-icon summary-icon--up"><Icon name="north" /></span><p><b>{hasUpRates ? formatRate(up) : "未完整提供"}</b><span>上传速率</span></p></div>
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
            <thead><tr><th>协议</th><th>账号</th><th>来源 IP</th><th>连接数</th><th>下载速率</th><th>上传速率</th><th>持续时间</th></tr></thead>
            <tbody>{filtered.map((item) => (
              <tr key={item.id}>
                <td data-label="协议"><Chip staticChip tone={item.protocol === "Hysteria2" ? "info" : "default"}>{item.protocol}</Chip></td>
                <td data-label="账号"><div className="account-inline"><span className="status-dot status-dot--online" /><strong>{item.account}</strong></div></td>
                <td data-label="来源 IP"><div className="ip-cell"><code>{item.sourceIp}</code>{item.ipVersion ? <Chip staticChip>IPv{item.ipVersion}</Chip> : null}</div></td>
                <td data-label="连接数"><span className="connection-count">{item.connections}</span></td>
                <td data-label="下载速率"><span className="rate rate--down"><Icon name="south" size={17} />{item.downloadBps === null ? "核心未提供" : formatRate(item.downloadBps)}</span></td>
                <td data-label="上传速率"><span className="rate rate--up"><Icon name="north" size={17} />{item.uploadBps === null ? "核心未提供" : formatRate(item.uploadBps)}</span></td>
                <td data-label="持续时间"><span className="mono-time">{item.connectedAt ? formatDuration((now - new Date(item.connectedAt).getTime()) / 1000) : "核心未提供"}</span></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="table-footer"><span>每 5 秒拉取快照 · 不对缺失字段造值</span><span>条目、账号、来源地址与累计字节均取决于协议核心实际返回内容</span></div>
      </Card>
    </div>
  );
}
