"use client";

import { useMemo, useState } from "react";
import { formatDuration, formatRate } from "../../lib/format";
import { copyText } from "../../lib/clipboard";
import { useI18n } from "../../lib/i18n";
import type { Connection, IntegrationStatus, Protocol } from "../../lib/types";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { PageHeader } from "../ui/Page";

export function ConnectionsPage({ connections, now, onToast, integration, onConfigure }: { connections: Connection[]; now: number; onToast: (message: string) => void; integration?: IntegrationStatus; onConfigure: () => void }) {
  const { t } = useI18n();
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
      <PageHeader eyebrow={t("协议快照", "Protocol snapshots")} title={t("活动连接", "Active connections")} description={t("重复来源按协议、账号和 IP 聚合；展开后只显示核心实际返回的目标和真实快照速率。", "Repeated sources are grouped by protocol, account, and IP. Expanded rows show only destinations returned by the core and rates from real snapshots.")} actions={<Chip staticChip tone={integration?.status === "ready" ? "success" : "warning"} icon="schedule">{t("5 秒轮询", "5-second polling")}</Chip>} />
      <IntegrationGate status={integration} name="连接快照采集" nameEn="Connection snapshots" description="Hysteria2 当前不提供来源 IP；sing-box 适配器按真实入站标签展示连接。未知字段不会补成 0 或虚构地址。" descriptionEn="Hysteria2 currently omits source IPs. sing-box adapters classify connections by real inbound tags. Missing fields are never filled with zeroes or invented addresses." onConfigure={onConfigure} />

      <section className="summary-strip">
        <div><span className="summary-icon"><Icon name="group_work" /></span><p><b>{filtered.length}</b><span>{t("聚合连接组", "Connection groups")}</span></p></div>
        <div><span className="summary-icon"><Icon name="hub" /></span><p><b>{filtered.reduce((sum, item) => sum + item.connections, 0)}</b><span>{t("活动子条目", "Active entries")}</span></p></div>
        {hasDownRates ? <div><span className="summary-icon summary-icon--down"><Icon name="south" /></span><p><b>{formatRate(down)}</b><span>{t("已计算下载速率", "Calculated download rate")}</span></p></div> : null}
        {hasUpRates ? <div><span className="summary-icon summary-icon--up"><Icon name="north" /></span><p><b>{formatRate(up)}</b><span>{t("已计算上传速率", "Calculated upload rate")}</span></p></div> : null}
      </section>

      <Card variant="outlined" className="table-panel">
        <div className="table-toolbar table-toolbar--wrap">
          <div className="filter-chips">
            {(["all", "Hysteria2", "AnyTLS", "VLESS", "SOCKS5", "Shadowsocks", "sing-box"] as const).map((item) => <Chip key={item} selected={protocol === item} onClick={() => setProtocol(item)}>{item === "all" ? t("全部协议", "All protocols") : item}</Chip>)}
          </div>
          <div className="segmented-control" aria-label={t("IP 版本筛选", "IP version filter")}>
            {(["all", 4, 6] as const).map((item) => <button className={ipVersion === item ? "is-selected" : ""} key={item} onClick={() => setIpVersion(item)}>{item === "all" ? t("全部 IP", "All IPs") : `IPv${item}`}</button>)}
          </div>
        </div>
        <div className="responsive-table connections-table">
          <table>
            <thead><tr><th>{t("协议", "Protocol")}</th><th>{t("账号", "Account")}</th><th>{t("来源 IP", "Source IP")}</th><th>{t("活动条目", "Entries")}</th>{hasDownRates ? <th>{t("下载速率", "Download")}</th> : null}{hasUpRates ? <th>{t("上传速率", "Upload")}</th> : null}<th>{t("持续时间", "Duration")}</th><th aria-label={t("展开详情", "Expand details")} /></tr></thead>
            <tbody>{filtered.flatMap((item) => {
              const details = item.details ?? [];
              const isExpanded = expanded.has(item.id);
              const columns = 6 + Number(hasDownRates) + Number(hasUpRates);
              return [<tr key={item.id}>
                <td data-label={t("协议", "Protocol")}><Chip staticChip tone={item.protocol === "Hysteria2" ? "info" : "default"}>{item.protocol}</Chip></td>
                <td data-label={t("账号", "Account")}><div className="account-inline"><span className="status-dot status-dot--online" /><strong>{item.account}</strong></div></td>
                <td data-label={t("来源 IP", "Source IP")}><div className="ip-cell"><code>{item.sourceIp}</code>{item.ipVersion ? <><Chip staticChip>IPv{item.ipVersion}</Chip><button className="copy-ip-button" aria-label={t(`复制 ${item.sourceIp}`, `Copy ${item.sourceIp}`)} onClick={() => void copyText(item.sourceIp).then(() => onToast(t("来源 IP 已复制", "Source IP copied"))).catch(() => onToast(t("复制失败", "Copy failed")))}><Icon name="content_copy" size={17} /></button></> : null}</div></td>
                <td data-label={t("活动条目", "Entries")}><span className="connection-count">{item.connections}</span></td>
                {hasDownRates ? <td data-label={t("下载速率", "Download")}><span className="rate rate--down"><Icon name="south" size={17} />{item.downloadBps === null ? t("等待连续快照", "Waiting for consecutive snapshots") : formatRate(item.downloadBps)}</span></td> : null}
                {hasUpRates ? <td data-label={t("上传速率", "Upload")}><span className="rate rate--up"><Icon name="north" size={17} />{item.uploadBps === null ? t("等待连续快照", "Waiting for consecutive snapshots") : formatRate(item.uploadBps)}</span></td> : null}
                <td data-label={t("持续时间", "Duration")}><span className="mono-time">{item.connectedAt ? formatDuration((now - new Date(item.connectedAt).getTime()) / 1000) : t("核心未提供", "Not provided by core")}</span></td>
                <td>{details.length ? <button className="connection-expand" onClick={() => toggleExpanded(item.id)} aria-expanded={isExpanded} aria-label={isExpanded ? t("收起连接详情", "Collapse connection details") : t("展开连接详情", "Expand connection details")}><Icon name={isExpanded ? "expand_less" : "expand_more"} /></button> : null}</td>
              </tr>, ...(isExpanded ? details.map((detail) => <tr className="connection-detail-row" key={`${item.id}-${detail.id}`}><td colSpan={columns}><div className="connection-detail"><code>{detail.destination}</code><span>{detail.connectedAt ? t(`已连接 ${formatDuration((now - new Date(detail.connectedAt).getTime()) / 1000)}`, `Connected for ${formatDuration((now - new Date(detail.connectedAt).getTime()) / 1000)}`) : t("开始时间未提供", "Start time not provided")}</span>{detail.downloadBps !== null ? <span><Icon name="south" size={16} />{formatRate(detail.downloadBps)}</span> : null}{detail.uploadBps !== null ? <span><Icon name="north" size={16} />{formatRate(detail.uploadBps)}</span> : null}</div></td></tr>) : [])];
            })}</tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
