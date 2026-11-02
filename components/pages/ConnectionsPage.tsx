"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchConnectionTargets } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { CLOSED_CONNECTION_RETENTION_MS, connectionDestination, connectionDuration, listedRate, matchesConnectionTarget, reconcileLiveConnections, visibleLiveConnections, type ConnectionFilters, type LiveConnection, type LiveDetail } from "../../lib/connection-view";
import { formatDuration, formatRate } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import type { Connection, IntegrationStatus } from "../../lib/types";
import { IntegrationGate } from "../setup/IntegrationGate";
import { AnimatedDetails } from "../ui/AnimatedDetails";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Collapse } from "../ui/Collapse";
import { Icon } from "../ui/Icon";
import { MaterialSelect } from "../ui/MaterialSelect";
import { PageHeader } from "../ui/Page";
import { AnimatedRecords } from "../ui/RecordHistory";
import { usePresence } from "../ui/usePresence";

const emptyFilters: ConnectionFilters = { ip: "", ipMode: "contains", domain: "", domainMode: "contains", port: "" };

function TargetDisclosure({ shown, details, now, stale, onCopy }: { shown: boolean; details: LiveDetail[]; now: number; stale: boolean; onCopy: (value: string) => void }) {
  const { t } = useI18n();
  const present = usePresence(shown && details.length > 0);
  return <Collapse expanded={shown && present && details.length > 0} className="connection-targets-collapse">{present ? <AnimatedDetails className="connection-disclosure"><summary>{t("查看目标", "View destinations")}<Icon name="expand_more" size={18} /></summary><TargetList details={details} now={now} stale={stale} onCopy={onCopy} /></AnimatedDetails> : null}</Collapse>;
}

function TargetList({ details, now, stale, onCopy }: { details: LiveDetail[]; now: number; stale: boolean; onCopy: (value: string) => void }) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(10);
  const filtered = useMemo(() => details.map((item) => ({ ...item, ...connectionDestination(item.destination) })).filter((item) => `${item.destination} ${item.address} ${item.port ?? ""}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).sort((a, b) => Number(a.closedAt !== undefined) - Number(b.closedAt !== undefined) || ((b.downloadBps ?? 0) + (b.uploadBps ?? 0)) - ((a.downloadBps ?? 0) + (a.uploadBps ?? 0)) || a.id.localeCompare(b.id)), [details, search]);
  return <div className="connection-targets">
    {details.length > 10 || search !== "" ? <label className="connection-search">{t("查找目标", "Find destination")}<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(10); }} placeholder={t("域名或 IP", "Domain or IP")} /></label> : null}
    <AnimatedRecords itemCount={Math.min(filtered.length, limit)} transitionKey={filtered.slice(0, limit).map((detail) => detail.id).join("|")}><ul className="connection-target-list">{filtered.slice(0, limit).map((detail) => {
      const seconds = connectionDuration(detail.connectedAt, now);
      const closed = detail.closedAt !== undefined;
      const remaining = Math.max(0, Math.ceil((CLOSED_CONNECTION_RETENTION_MS - (now - (detail.closedAt ?? now))) / 1000));
      return <li key={detail.id} className={`connection-target ${closed ? "is-closed" : ""}`}>
        <div className="connection-address"><code>{detail.address}</code><button className="copy-ip-button" aria-label={t(`复制目标地址 ${detail.address}`, `Copy destination address ${detail.address}`)} onClick={() => onCopy(detail.address)}><Icon name="content_copy" size={17} /></button></div>
        <div className="connection-target-meta">{detail.port ? <span className="connection-port">{t("端口", "Port")} <b>{detail.port}</b></span> : null}<span className="rate rate--up">↑ {closed || stale || detail.uploadBps === null ? "—" : formatRate(detail.uploadBps)}</span><span className="rate rate--down">↓ {closed || stale || detail.downloadBps === null ? "—" : formatRate(detail.downloadBps)}</span>{closed ? <span className="connection-countdown">{t("已关闭", "Closed")} · {t(`${remaining}s 后移除`, `Removed in ${remaining}s`)}</span> : seconds !== null ? <span>{t("已持续", "Open for")} {formatDuration(seconds)}</span> : null}</div>
      </li>;
    })}</ul></AnimatedRecords>
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
  const [targetAvailable, setTargetAvailable] = useState<boolean | null>(null);
  const [liveGroups, setLiveGroups] = useState<LiveConnection[]>([]);
  const [targetError, setTargetError] = useState(false);
  const [addressFilters, setAddressFilters] = useState<ConnectionFilters>(emptyFilters);
  const needsTargets = showTargets || Boolean(addressFilters.ip.trim() || addressFilters.domain.trim() || addressFilters.port.trim());
  const protocols = useMemo(() => Array.from(new Set(connections.map((item) => item.protocol.startsWith("VLESS") ? "VLESS" : item.protocol))).sort(), [connections]);
  // Keep an explicit filter when a protocol temporarily disappears during polling.
  const groups = useMemo(() => {
    if (!needsTargets) return connections.map((item) => ({ ...item, details: [] as LiveDetail[] }));
    const visible = visibleLiveConnections(liveGroups, now);
    const old = new Map(visible.map((item) => [item.id, item]));
    return [...connections.map((item) => ({ ...item, details: old.get(item.id)?.details ?? [] })), ...visible.filter((item) => !connections.some((current) => current.id === item.id))];
  }, [connections, liveGroups, needsTargets, now]);
  const filtered = useMemo(() => groups.flatMap((item) => {
    if (!(protocol === "all" || item.protocol === protocol || protocol === "VLESS" && item.protocol.startsWith("VLESS")) || !(ipVersion === "all" || String(item.ipVersion) === ipVersion)) return [];
    const details = item.details.filter((detail) => matchesConnectionTarget(item.sourceIp, detail, addressFilters));
    if (!details.length && !matchesConnectionTarget(item.sourceIp, undefined, addressFilters)) return [];
    return [{ ...item, details }];
  }), [groups, ipVersion, protocol, addressFilters]);
  const hasFilter = protocol !== "all" || ipVersion !== "all" || Boolean(addressFilters.ip.trim() || addressFilters.domain.trim() || addressFilters.port.trim());
  const clearFilters = () => { setProtocol("all"); setIpVersion("all"); setAddressFilters(emptyFilters); };
  useEffect(() => {
    if (!needsTargets || stale) return;
    const controller = new AbortController();
    void fetchConnectionTargets(controller.signal).then((value) => { if (!controller.signal.aborted) { setLiveGroups((previous) => reconcileLiveConnections(previous, connections, value, Date.now())); setTargetAvailable(value.available); setTargetError(false); } }).catch(() => { if (!controller.signal.aborted) setTargetError(true); });
    return () => controller.abort();
  }, [connections, needsTargets, stale]);
  const copy = (value: string) => void copyText(value).then(() => onToast(t("已复制", "Copied"))).catch(() => onToast(t("复制失败", "Copy failed")));
  const duration = (item: Connection) => { const seconds = connectionDuration(item.connectedAt, now); return seconds === null ? null : <span>{t("当前最早连接已持续", "Oldest current connection")} {formatDuration(seconds)}</span>; };
  const rate = (value: number | null) => value === null || stale ? "—" : formatRate(value);

  return <div className="page-content page-enter connections-page">
    <PageHeader title={t("在线连接", "Active connections")} />
    <IntegrationGate status={integration} name="连接快照采集" nameEn="Connection snapshots" description="接入协议统计后即可查看活动连接。" descriptionEn="Connect protocol statistics to view active connections." onConfigure={onConfigure} />
    {stale ? <p className="connection-status" role="status">{t("采集未更新，以下为上次连接记录，速率暂不可用", "Collection is not updating. These are previous connections; rates are unavailable.")}</p> : null}
    <section className="connection-summary" aria-label={t("在线连接速率与显示", "Active connection rates and display")}>
    <div className="connection-speeds">
      <div><span className="rate--up"><Icon name="north" size={18} />{t("在线连接总上传", "Total connection upload")}</span><strong>{rate(listedRate(connections, "uploadBps"))}</strong></div>
      <div><span className="rate--down"><Icon name="south" size={18} />{t("在线连接总下载", "Total connection download")}</span><strong>{rate(listedRate(connections, "downloadBps"))}</strong></div>
    </div>
    <div className="connection-controls">
      <Button variant="tonal" icon="filter_list" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}>{hasFilter ? t("筛选中", "Filters applied") : t("筛选", "Filter")}</Button>
      {hasFilter ? <Button variant="text" onClick={clearFilters}>{t("清除筛选", "Clear filters")}</Button> : null}
      <div className="connection-live-toggle"><div><span>{t("显示实时连接", "Show live connections")}</span><small>{showTargets ? t("已开启", "On") : t("已关闭", "Off")}</small></div><button type="button" className={`md-switch ${showTargets ? "is-on" : ""}`} role="switch" aria-checked={showTargets} aria-label={t("显示实时连接", "Show live connections")} onClick={() => { setShowTargets((value) => !value); setTargetError(false); }}><span /></button></div>
    </div>
    <Collapse expanded={filtersOpen} className="connection-filters-collapse"><div className="connection-filters">
      <div className="connection-filter-field"><span>{t("协议", "Protocol")}</span><MaterialSelect ariaLabel={t("协议", "Protocol")} value={protocol} onChange={setProtocol} searchable={protocols.length > 6} options={[{ value: "all", label: t("全部协议", "All protocols") }, ...Array.from(new Set([...protocols, ...(protocol === "all" ? [] : [protocol])])).map((item) => ({ value: item, label: item }))]} /></div>
      <div className="connection-filter-field"><span>{t("来源 IP", "Source IP")}</span><MaterialSelect ariaLabel={t("来源 IP", "Source IP")} value={ipVersion} onChange={setIpVersion} options={[{ value: "all", label: t("全部来源", "All sources") }, { value: "4", label: "IPv4" }, { value: "6", label: "IPv6" }, { value: "null", label: t("未提供来源", "Source not provided") }]} /></div>
      {(["ip", "domain"] as const).map((field) => <div className="connection-filter-field" key={field}><label className="connection-search">{field === "ip" ? t("IP 地址", "IP address") : t("目标域名", "Destination domain")}<input type="search" value={addressFilters[field]} placeholder={field === "ip" ? t("来源或目标 IP", "Source or destination IP") : "example.test"} onChange={(event) => setAddressFilters((value) => ({ ...value, [field]: event.target.value }))} /></label><MaterialSelect ariaLabel={field === "ip" ? t("IP 匹配方式", "IP match mode") : t("域名匹配方式", "Domain match mode")} value={addressFilters[`${field}Mode`]} onChange={(mode) => setAddressFilters((value) => ({ ...value, [`${field}Mode`]: mode as "contains" | "exact" }))} options={[{ value: "contains", label: t("关键词匹配", "Keyword match") }, { value: "exact", label: t("精确匹配", "Exact match") }]} /></div>)}
      <label className="connection-filter-field connection-search">{t("目标端口", "Destination port")}<input type="search" inputMode="numeric" value={addressFilters.port} placeholder="443" onChange={(event) => setAddressFilters((value) => ({ ...value, port: event.target.value }))} /></label>
    </div></Collapse>
    </section>
    <Collapse expanded={needsTargets && (targetError || stale || targetAvailable === false)}><p className="connection-status" role="status">{targetError ? t("目标读取失败，保留上次记录，请稍后重试", "Could not read destinations. Previous records are retained; please retry.") : t("暂无可用的实时目标，保留上次记录", "Live destinations unavailable. Previous records are retained.")}</p></Collapse>
    <AnimatedRecords itemCount={filtered.length} transitionKey={`${protocol}:${ipVersion}:${JSON.stringify(addressFilters)}:${filtered.map((item) => item.id).join("|")}`}><div className="connection-list">{filtered.map((item) => {
      const details = item.details;
      return <Card key={item.id} variant="outlined" className="connection-card" data-connection-id={item.id}>
        <div className="connection-card-header"><Chip staticChip>{item.protocol}</Chip><div className="connection-card-rates"><span className="rate rate--up">↑ {rate(item.uploadBps)}</span><span className="rate rate--down">↓ {rate(item.downloadBps)}</span></div></div>
        {item.sourceIp ? <div className="connection-address"><span>{t("来源", "Source")}</span><code>{item.sourceIp}</code><button className="copy-ip-button" aria-label={t(`复制 ${item.sourceIp}`, `Copy ${item.sourceIp}`)} onClick={() => copy(item.sourceIp)}><Icon name="content_copy" size={17} /></button></div> : null}
        {item.account ? <div className="connection-account">{t("账号", "Account")} <strong>{item.account}</strong></div> : null}
        <div className="connection-card-meta">{!stale && item.onlineClients !== undefined ? <span>{t(`${item.onlineClients} 个在线客户端`, `${item.onlineClients} online clients`)}</span> : null}<span>{item.entriesAvailable === false ? t("连接条目暂不可用", "Connection entries unavailable") : item.protocol === "Hysteria2" ? t(`${item.connections} 条 TCP 连接`, `${item.connections} TCP connections`) : t(`${item.connections} 条代理连接`, `${item.connections} proxy connections`)}</span>{duration(item)}</div>
        <TargetDisclosure shown={showTargets} details={details} now={now} stale={stale || targetError || targetAvailable === false} onCopy={copy} />
      </Card>;
    })}</div></AnimatedRecords>
    {!filtered.length ? <div className="table-empty"><Icon name="link_off" size={28} /><strong>{hasFilter ? t("没有符合筛选条件的连接", "No connections match these filters") : t("当前没有可显示的连接", "No connections to show right now")}</strong>{hasFilter ? <Button variant="text" onClick={clearFilters}>{t("清除筛选", "Clear filters")}</Button> : null}</div> : null}
  </div>;
}
