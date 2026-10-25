"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchConnectionTargets } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { connectionDuration, listedRate } from "../../lib/connection-view";
import { formatDuration, formatRate } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { Connection, ConnectionDetail, ConnectionTargets, IntegrationStatus } from "../../lib/types";
import { IntegrationGate } from "../setup/IntegrationGate";
import { AnimatedDetails } from "../ui/AnimatedDetails";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Icon } from "../ui/Icon";
import { MaterialSelect } from "../ui/MaterialSelect";
import { PageHeader } from "../ui/Page";

type TargetDetail = ConnectionDetail & { destination: string };

function TargetList({ details, now, onCopy }: { details: TargetDetail[]; now: number; onCopy: (value: string) => void }) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(10);
  const filtered = useMemo(() => details.filter((item) => item.destination.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => ((b.downloadBps ?? 0) + (b.uploadBps ?? 0)) - ((a.downloadBps ?? 0) + (a.uploadBps ?? 0)) || a.id.localeCompare(b.id)), [details, search]);
  return <div className="connection-targets">
    {details.length > 10 ? <label className="connection-search">{t("查找目标", "Find destination")}<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(10); }} placeholder={t("域名或 IP", "Domain or IP")} /></label> : null}
    <ul className="connection-target-list">{filtered.slice(0, limit).map((detail) => {
      const seconds = connectionDuration(detail.connectedAt, now);
      return <li key={detail.id} className="connection-target">
        <div className="connection-address"><code>{detail.destination}</code><button className="copy-ip-button" aria-label={t(`复制目标 ${detail.destination}`, `Copy destination ${detail.destination}`)} onClick={() => onCopy(detail.destination)}><Icon name="content_copy" size={17} /></button></div>
        <div className="connection-target-meta"><span className="rate rate--down">↓ {detail.downloadBps === null ? "—" : formatRate(detail.downloadBps)}</span><span className="rate rate--up">↑ {detail.uploadBps === null ? "—" : formatRate(detail.uploadBps)}</span>{seconds !== null ? <span>{t("已持续", "Open for")} {formatDuration(seconds)}</span> : null}</div>
      </li>;
    })}</ul>
    {!filtered.length ? <p role="status">{t("没有符合条件的目标", "No matching destinations")}</p> : null}
    {filtered.length > limit ? <Button variant="text" onClick={() => setLimit((value) => value + 10)}>{t("再显示 10 条", "Show 10 more")}</Button> : null}
  </div>;
}

export function ConnectionsPage({ connections, now, onToast, integration, onConfigure, stale = false }: { connections: Connection[]; now: number; onToast: (message: string) => void; integration?: IntegrationStatus; onConfigure: () => void; stale?: boolean }) {
  const { t } = useI18n();
  const [protocol, setProtocol] = useState("all");
  const [ipVersion, setIpVersion] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showTargets, setShowTargets] = useState(false);
  const [targets, setTargets] = useState<ConnectionTargets | null>(null);
  const [targetError, setTargetError] = useState(false);
  const protocols = useMemo(() => Array.from(new Set(connections.map((item) => item.protocol.startsWith("VLESS") ? "VLESS" : item.protocol))).sort(), [connections]);
  // Keep an explicit filter when a protocol temporarily disappears during polling.
  const filtered = useMemo(() => connections.filter((item) => (protocol === "all" || item.protocol === protocol || protocol === "VLESS" && item.protocol.startsWith("VLESS")) && (ipVersion === "all" || String(item.ipVersion) === ipVersion)), [connections, ipVersion, protocol]);
  const hasFilter = protocol !== "all" || ipVersion !== "all";
  useEffect(() => {
    if (!showTargets || stale) return;
    const controller = new AbortController();
    void fetchConnectionTargets(controller.signal).then((value) => { if (!controller.signal.aborted) { setTargets(value); setTargetError(false); } }).catch(() => { if (!controller.signal.aborted) { setTargets(null); setTargetError(true); } });
    return () => controller.abort();
  }, [connections, showTargets, stale]);
  const copy = (value: string) => void copyText(value).then(() => onToast(t("已复制", "Copied"))).catch(() => onToast(t("复制失败", "Copy failed")));
  const duration = (item: Connection) => { const seconds = connectionDuration(item.connectedAt, now); return seconds === null ? null : <span>{t("当前最早连接已持续", "Oldest current connection")} {formatDuration(seconds)}</span>; };
  const rate = (value: number | null) => value === null || stale ? "—" : formatRate(value);

  return <div className="page-content page-enter connections-page">
    <PageHeader title={t("在线连接", "Active connections")} />
    <IntegrationGate status={integration} name="连接快照采集" nameEn="Connection snapshots" description="接入协议统计后即可查看活动连接。" descriptionEn="Connect protocol statistics to view active connections." onConfigure={onConfigure} />
    {stale ? <p className="connection-status" role="status">{t("采集未更新，以下为上次连接记录，速率暂不可用", "Collection is not updating. These are previous connections; rates are unavailable.")}</p> : null}
    <section className="connection-speeds" aria-label={t("已列出连接的采样速率", "Sampled rates of listed connections")}>
      <div><span className="rate--down"><Icon name="south" size={18} />{t("已列出连接下载", "Listed connection download")}</span><strong>{rate(listedRate(filtered, "downloadBps"))}</strong></div>
      <div><span className="rate--up"><Icon name="north" size={18} />{t("已列出连接上传", "Listed connection upload")}</span><strong>{rate(listedRate(filtered, "uploadBps"))}</strong></div>
    </section>
    <div className="connection-controls">
      <Button variant="tonal" icon="filter_list" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}>{hasFilter ? t("筛选中", "Filters applied") : t("筛选", "Filter")}</Button>
      <Button variant="text" icon={showTargets ? "visibility_off" : "visibility"} aria-pressed={showTargets} onClick={() => { setShowTargets((value) => !value); setTargets(null); setTargetError(false); }}>{showTargets ? t("隐藏实时目标", "Hide live destinations") : t("查看实时目标", "View live destinations")}</Button>
      {hasFilter ? <Button variant="text" onClick={() => { setProtocol("all"); setIpVersion("all"); }}>{t("清除筛选", "Clear filters")}</Button> : null}
    </div>
    {filtersOpen ? <div className="connection-filters">
      <div className="connection-filter-field"><span>{t("协议", "Protocol")}</span><MaterialSelect ariaLabel={t("协议", "Protocol")} value={protocol} onChange={setProtocol} searchable={protocols.length > 6} options={[{ value: "all", label: t("全部协议", "All protocols") }, ...Array.from(new Set([...protocols, ...(protocol === "all" ? [] : [protocol])])).map((item) => ({ value: item, label: item }))]} /></div>
      <div className="connection-filter-field"><span>{t("来源 IP", "Source IP")}</span><MaterialSelect ariaLabel={t("来源 IP", "Source IP")} value={ipVersion} onChange={setIpVersion} options={[{ value: "all", label: t("全部来源", "All sources") }, { value: "4", label: "IPv4" }, { value: "6", label: "IPv6" }, { value: "null", label: t("未提供来源", "Source not provided") }]} /></div>
    </div> : null}
    {showTargets ? <p className="connection-status" role="status">{targetError ? t("目标读取失败，请稍后重试", "Could not read destinations. Please retry.") : stale || targets && !targets.available ? t("暂无可用的实时目标", "No live destinations available") : targets ? t("目标仅在本次页面查看，离开页面后隐藏", "Destinations are visible only on this page and hidden when you leave") : t("正在读取实时目标…", "Reading live destinations…")}</p> : null}
    <div className="connection-list">{filtered.map((item) => {
      const targetGroup = !stale && showTargets ? targets?.groups.find((group) => group.id === item.id) : undefined;
      const destinations = new Map(targetGroup?.details.map((detail) => [detail.id, detail.destination]));
      const details = (item.details ?? []).flatMap((detail) => { const destination = destinations.get(detail.id); return destination ? [{ ...detail, destination }] : []; });
      return <Card key={item.id} variant="outlined" className="connection-card" data-connection-id={item.id}>
        <div className="connection-card-header"><Chip staticChip>{item.protocol}</Chip><div className="connection-card-rates"><span className="rate rate--down">↓ {rate(item.downloadBps)}</span><span className="rate rate--up">↑ {rate(item.uploadBps)}</span></div></div>
        {item.sourceIp ? <div className="connection-address"><span>{t("来源", "Source")}</span><code>{item.sourceIp}</code><button className="copy-ip-button" aria-label={t(`复制 ${item.sourceIp}`, `Copy ${item.sourceIp}`)} onClick={() => copy(item.sourceIp)}><Icon name="content_copy" size={17} /></button></div> : null}
        {item.account ? <div className="connection-account">{t("账号", "Account")} <strong>{item.account}</strong></div> : null}
        <div className="connection-card-meta">{!stale && item.onlineClients !== undefined ? <span>{t(`${item.onlineClients} 个在线客户端`, `${item.onlineClients} online clients`)}</span> : null}<span>{item.entriesAvailable === false ? t("连接条目暂不可用", "Connection entries unavailable") : item.protocol === "Hysteria2" ? t(`${item.connections} 条 TCP 连接`, `${item.connections} TCP connections`) : t(`${item.connections} 条代理连接`, `${item.connections} proxy connections`)}</span>{duration(item)}</div>
        {details.length ? <AnimatedDetails className="connection-disclosure"><summary>{t("查看目标", "View destinations")}<Icon name="expand_more" size={18} /></summary><TargetList details={details} now={now} onCopy={copy} /></AnimatedDetails> : null}
      </Card>;
    })}</div>
    {!filtered.length ? <div className="table-empty"><Icon name="link_off" size={28} /><strong>{hasFilter ? t("没有符合筛选条件的连接", "No connections match these filters") : t("当前没有可显示的连接", "No connections to show right now")}</strong>{hasFilter ? <Button variant="text" onClick={() => { setProtocol("all"); setIpVersion("all"); }}>{t("清除筛选", "Clear filters")}</Button> : null}</div> : null}
    <AnimatedDetails className="connection-help"><summary>{t("这些数据代表什么", "About these measurements")}</summary><p>{t("速率由仍在列表中的连接采样得出，新连接与已断开的短连接可能未计入；不包含完整 UDP 流量。总览固定显示主网卡速率。", "Rates are sampled from connections still listed. New and short-lived connections may be absent; complete UDP traffic is not included. Overview always shows interface rates.")}</p><p>{t("Hysteria2 的在线客户端数来自独立接口，包含没有 TCP 活动的客户端；现有接口不提供来源地址。其他协议只显示能够确认的来源和账号。", "Hysteria2 client counts come from a separate API and include clients without TCP activity; that API does not provide source addresses. Other protocols show sources and identities only when provided.")}</p><p>{t("实时目标需要主动开启，仅展示域名或 IP 和端口，不是完整 HTTPS 访问链接；不写入连接历史、日志或导出。", "Live destinations require explicit viewing and show domains or IPs with ports, not full HTTPS URLs. They are not written to connection history, logs or exports.")}</p></AnimatedDetails>
  </div>;
}
