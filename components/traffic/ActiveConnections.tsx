"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { fetchConnectionTargets } from "../../lib/api";
import { copyText } from "../../lib/clipboard";
import { CLOSED_CONNECTION_RETENTION_MS, connectionDestination, connectionDuration, connectionRate, matchesConnectionTarget, reconcileLiveConnections, visibleLiveConnections, type ConnectionFilters, type LiveConnection, type LiveDetail } from "../../lib/connection-view";
import { formatDuration } from "../../lib/format";
import { useI18n } from "../../lib/i18n";
import { PROTOCOL_NAMES, type Connection, type ConnectionTargets, type IntegrationStatus } from "../../lib/types";
import { IntegrationGate } from "../setup/IntegrationGate";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Chip } from "../ui/Chip";
import { Collapse } from "../ui/Collapse";
import { Icon } from "../ui/Icon";
import { MaterialSelect } from "../ui/MaterialSelect";
import { M3_EXIT_DURATION_MS, usePresence } from "../ui/usePresence";
import { TrafficSection } from "./TrafficSection";

const emptyFilters: ConnectionFilters = { ip: "", ipMode: "contains", domain: "", domainMode: "contains", port: "" };
const hasAddressFilters = ({ ip, domain, port }: ConnectionFilters) => Boolean(ip.trim() || domain.trim() || port.trim());
const emptyTargets: { groups: LiveConnection[]; snapshot: Pick<ConnectionTargets, "available" | "sources"> | null; failed: boolean } = { groups: [], snapshot: null, failed: false };

function ConnectionRates({ uploadBps, downloadBps, stale }: { uploadBps: number | null; downloadBps: number | null; stale: boolean }) {
  const { t } = useI18n();
  const upload = connectionRate(uploadBps, stale);
  const download = connectionRate(downloadBps, stale);
  return <div className="connection-rates">
    <span className="rate rate--up" title={t(`上传 ${upload}`, `Upload ${upload}`)}>↑ {upload}</span>
    <span className="rate rate--down" title={t(`下载 ${download}`, `Download ${download}`)}>↓ {download}</span>
  </div>;
}

function TargetList({ details, now, stale, onCopy }: { details: LiveDetail[]; now: number; stale: boolean; onCopy: (value: string) => void }) {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(10);
  const [viewedIds, setViewedIds] = useState<string[]>([]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return details.filter((item) => item.destination.toLocaleLowerCase().includes(query));
  }, [details, search]);
  const pageIds = new Set([
    ...filtered.filter((item) => item.closedAt === undefined),
    ...filtered.filter((item) => item.closedAt !== undefined),
  ].slice(0, limit).map((item) => item.id));
  // Keep the same row in place during the closure countdown, even if ten
  // other active connections now fill the page.
  const shown = filtered.filter((item) => pageIds.has(item.id) || (item.closedAt !== undefined && viewedIds.includes(item.id)));
  const shownKey = JSON.stringify(shown.map((item) => item.id));
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setViewedIds(JSON.parse(shownKey) as string[]));
    return () => window.cancelAnimationFrame(frame);
  }, [shownKey]);

  return <div className="connection-targets">
    {details.length > 10 || search !== "" ? <label className="connection-search">{t("查找目标", "Find destination")}<input type="search" value={search} onChange={(event) => { setSearch(event.target.value); setLimit(10); }} placeholder={t("域名或 IP", "Domain or IP")} /></label> : null}
    <ul className="connection-target-list">{shown.map((detail) => {
      const { address, port } = connectionDestination(detail.destination);
      const seconds = connectionDuration(detail.connectedAt, now);
      const closed = detail.closedAt !== undefined;
      const remaining = Math.max(0, Math.ceil((CLOSED_CONNECTION_RETENTION_MS - Math.max(0, now - (detail.closedAt ?? now))) / 1000));
      return <li key={detail.id} className={`connection-target ${closed ? "is-closed" : ""}`}>
        <div className="connection-address">
          <code>{address}</code>
          <button type="button" className="copy-ip-button" aria-label={t(`复制目标地址 ${address}`, `Copy destination address ${address}`)} onClick={() => onCopy(address)}><Icon name="content_copy" size={16} /></button>
          {port ? <span className="connection-port">{t("端口", "Port")} {port}</span> : null}
        </div>
        <div className="connection-target-meta">
          <ConnectionRates {...detail} stale={stale || closed} />
          {closed ? <span className="connection-countdown">{t("已关闭", "Closed")} · {t(`${remaining}s 后移除`, `Removed in ${remaining}s`)}</span> : seconds !== null ? <span>{t("已持续", "Open for")} {formatDuration(seconds)}</span> : null}
        </div>
      </li>;
    })}</ul>
    {search && !filtered.length ? <p className="connection-status" role="status">{t("没有符合条件的目标", "No matching destinations")}</p> : null}
    {filtered.length > shown.length ? <Button variant="text" onClick={() => setLimit((value) => value + 10)}>{t("再显示 10 条", "Show 10 more")}</Button> : null}
  </div>;
}

function ConnectionCard({ item, open, onToggle, now, stale, reading, unavailable, onCopy }: {
  item: LiveConnection;
  open: boolean;
  onToggle: () => void;
  now: number;
  stale: boolean;
  reading: boolean;
  unavailable: boolean;
  onCopy: (value: string) => void;
}) {
  const { t } = useI18n();
  const detailsId = useId();
  const sourceId = useId();
  const present = usePresence(open);
  const seconds = connectionDuration(item.connectedAt, now);
  const targetStatus = unavailable ? t("实时连接明细暂不可用", "Live connection details unavailable")
    : reading ? t("正在读取连接明细…", "Reading connection details…")
      : t("暂无可显示的连接明细", "No connection details to show");
  const toggleLabel = t(`${item.protocol} 连接明细`, `${item.protocol} connection details`);
  return <Card variant="filled" className="connection-card" data-connection-id={item.id}>
    <div className="connection-card-header">
      <div className="connection-card-info">
        <Chip staticChip>{item.protocol}</Chip>
        <div className="connection-address">
          <span>{t("来源 IP", "Source IP")}</span>
          <code id={sourceId} title={item.sourceIp ? undefined : t("核心未提供来源 IP", "Source IP not provided by core")}>{item.sourceIp || "—"}</code>
          {item.sourceIp ? <button type="button" className="copy-ip-button" aria-label={t(`复制来源 IP ${item.sourceIp}`, `Copy source IP ${item.sourceIp}`)} onClick={() => onCopy(item.sourceIp)}><Icon name="content_copy" size={16} /></button> : null}
        </div>
        <div className="connection-card-meta">
          <span>{item.entriesAvailable === false ? t("条目暂不可用", "Entries unavailable") : t(`${item.connections} 条连接`, item.connections === 1 ? "1 connection" : `${item.connections} connections`)}</span>
          {seconds !== null ? <span title={t("当前最早连接已持续", "Oldest current connection")}>{t("持续", "Open for")} {formatDuration(seconds)}</span> : null}
        </div>
      </div>
      <div className="connection-card-actions">
        <ConnectionRates {...item} stale={stale} />
        <Button type="button" variant="text" className="connection-row-toggle" icon="expand_more" aria-label={toggleLabel} title={toggleLabel} aria-describedby={item.sourceIp ? sourceId : undefined} aria-expanded={open} aria-controls={detailsId} onClick={onToggle} />
      </div>
    </div>
    <Collapse id={detailsId} expanded={open && present} className="connection-targets-collapse">
      {present ? <div className="connection-detail-panel">
        {item.details.length || !reading && !unavailable && item.connections > 0
          ? <TargetList details={item.details} now={now} stale={stale || unavailable} onCopy={onCopy} />
          : null}
        {!item.details.length || unavailable ? <p className="connection-status" role="status">{targetStatus}</p> : null}
      </div> : null}
    </Collapse>
  </Card>;
}

export function ActiveConnections({ connections, sampledAt, now, onToast, integration, onConfigure, stale = false, focusSection = false }: {
  connections: Connection[];
  sampledAt?: string | null;
  now: number;
  onToast: (message: string) => void;
  integration?: IntegrationStatus;
  onConfigure: () => void;
  stale?: boolean;
  focusSection?: boolean;
}) {
  const { t } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  const filtersId = useId();
  const [section, setSection] = useState({ focusSection, expanded: true });
  if (section.focusSection !== focusSection) setSection({ focusSection, expanded: focusSection || section.expanded });
  const { expanded } = section;
  useEffect(() => {
    if (!focusSection) return;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView?.({ block: "start", behavior: "instant" });
  }, [focusSection]);

  const [protocol, setProtocol] = useState("all");
  const [ipVersion, setIpVersion] = useState("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set());
  const [targets, setTargets] = useState(emptyTargets);
  const [addressFilters, setAddressFilters] = useState<ConnectionFilters>(emptyFilters);
  const addressFiltered = hasAddressFilters(addressFilters);
  const hasFilter = protocol !== "all" || ipVersion !== "all" || addressFiltered;
  const groups = useMemo(() => {
    const visible = visibleLiveConnections(targets.groups, now);
    const current = new Map(connections.map((item) => [item.id, { ...item, details: [] } as LiveConnection]));
    for (const item of visible) {
      const summary = current.get(item.id);
      if (summary) current.set(item.id, { ...summary, details: item.details });
      else if (openGroups.has(item.id) || addressFiltered) current.set(item.id, item);
    }
    return [...current.values()].sort((a, b) => PROTOCOL_NAMES.indexOf(a.protocol) - PROTOCOL_NAMES.indexOf(b.protocol) || a.sourceIp.localeCompare(b.sourceIp) || a.id.localeCompare(b.id));
  }, [addressFiltered, connections, now, openGroups, targets.groups]);
  const needsTargets = expanded && (addressFiltered || groups.some((item) => openGroups.has(item.id)));
  const protocols = Array.from(new Set(connections.map((item) => item.protocol.startsWith("VLESS") ? "VLESS" : item.protocol))).sort();
  const filtered = groups.flatMap((item) => {
    if (!(protocol === "all" || item.protocol === protocol || protocol === "VLESS" && item.protocol.startsWith("VLESS")) || !(ipVersion === "all" || String(item.ipVersion) === ipVersion)) return [];
    if (!addressFiltered) return [item];
    const details = item.details.filter((detail) => matchesConnectionTarget(item.sourceIp, detail, addressFilters));
    if (!details.length && !matchesConnectionTarget(item.sourceIp, undefined, addressFilters)) return [];
    return [{ ...item, details }];
  });

  useEffect(() => {
    if (needsTargets) return;
    // Leave the contents in place until the disclosure has finished closing.
    const timer = window.setTimeout(() => setTargets(emptyTargets), M3_EXIT_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [needsTargets]);
  useEffect(() => {
    if (!needsTargets || stale) return;
    const controller = new AbortController();
    void fetchConnectionTargets(controller.signal).then((snapshot) => {
      if (controller.signal.aborted) return;
      const sameSample = !sampledAt || !snapshot.sampledAt || sampledAt === snapshot.sampledAt;
      setTargets((previous) => ({
        groups: reconcileLiveConnections(previous.groups, connections, snapshot, Date.now(), sameSample),
        snapshot: { available: snapshot.available, sources: snapshot.sources },
        failed: false,
      }));
    }).catch(() => {
      if (!controller.signal.aborted) setTargets((previous) => ({ ...previous, failed: true }));
    });
    return () => controller.abort();
  }, [connections, needsTargets, sampledAt, stale]);

  const toggleGroup = (id: string) => setOpenGroups((previous) => {
    const next = new Set(groups.filter((item) => previous.has(item.id)).map((item) => item.id));
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const clearFilters = () => { setProtocol("all"); setIpVersion("all"); setAddressFilters(emptyFilters); };
  const copy = (value: string) => void copyText(value).then(() => onToast(t("已复制", "Copied"))).catch(() => onToast(t("复制失败", "Copy failed")));
  const targetsUnavailable = stale || targets.failed || targets.snapshot?.available === false;
  const filterPending = addressFiltered && !targetsUnavailable && !targets.snapshot;
  const filterButton = <Button type="button" variant="tonal" compact icon="filter_list" aria-expanded={filtersOpen} aria-controls={filtersId} onClick={() => setFiltersOpen((value) => !value)}>{hasFilter ? t("筛选中", "Filters applied") : t("筛选", "Filter")}</Button>;

  return <TrafficSection className="active-connections" title={t("实时连接", "Live connections")} expanded={expanded} headingRef={heading} action={filterButton} onToggle={() => {
    setSection({ focusSection, expanded: !expanded });
    if (expanded) setFiltersOpen(false);
  }}>
    <div className="connection-section-content">
      <Collapse id={filtersId} expanded={expanded && filtersOpen} className="connection-filters-collapse"><div className="connection-filters">
        <div className="connection-filter-field"><span>{t("协议", "Protocol")}</span><MaterialSelect ariaLabel={t("协议", "Protocol")} value={protocol} onChange={setProtocol} searchable={protocols.length > 6} options={[{ value: "all", label: t("全部协议", "All protocols") }, ...Array.from(new Set([...protocols, ...(protocol === "all" ? [] : [protocol])])).map((item) => ({ value: item, label: item }))]} /></div>
        <div className="connection-filter-field"><span>{t("来源 IP", "Source IP")}</span><MaterialSelect ariaLabel={t("来源 IP", "Source IP")} value={ipVersion} onChange={setIpVersion} options={[{ value: "all", label: t("全部来源", "All sources") }, { value: "4", label: "IPv4" }, { value: "6", label: "IPv6" }, { value: "null", label: t("未提供来源", "Source not provided") }]} /></div>
        {(["ip", "domain"] as const).map((field) => <div className="connection-filter-field" key={field}><label className="connection-search">{field === "ip" ? t("IP 地址", "IP address") : t("目标域名", "Destination domain")}<input type="search" value={addressFilters[field]} placeholder={field === "ip" ? t("来源或目标 IP", "Source or destination IP") : "example.test"} onChange={(event) => setAddressFilters({ ...addressFilters, [field]: event.target.value })} /></label><MaterialSelect ariaLabel={field === "ip" ? t("IP 匹配方式", "IP match mode") : t("域名匹配方式", "Domain match mode")} value={addressFilters[`${field}Mode`]} onChange={(mode) => setAddressFilters((value) => ({ ...value, [`${field}Mode`]: mode as "contains" | "exact" }))} options={[{ value: "contains", label: t("关键词匹配", "Keyword match") }, { value: "exact", label: t("精确匹配", "Exact match") }]} /></div>)}
        <label className="connection-filter-field connection-search">{t("目标端口", "Destination port")}<input type="search" inputMode="numeric" value={addressFilters.port} placeholder="443" onChange={(event) => setAddressFilters({ ...addressFilters, port: event.target.value })} /></label>
        {hasFilter ? <Button type="button" variant="text" onClick={clearFilters}>{t("清除筛选", "Clear filters")}</Button> : null}
      </div></Collapse>
      <div className="connection-section-body">
      <IntegrationGate status={integration} name="连接快照采集" nameEn="Connection snapshots" description="接入协议统计后即可查看实时连接。" descriptionEn="Connect protocol statistics to view live connections." onConfigure={onConfigure} />
      {stale ? <p className="connection-status" role="status">{t("采集未更新，以下为上次连接记录，速率暂不可用", "Collection is not updating. These are previous connections; rates are unavailable.")}</p> : null}
      {addressFiltered && targetsUnavailable && !stale ? <p className="connection-status" role="status">{t("目标读取暂不可用，筛选使用上次记录", "Destination lookup is unavailable. Filters use the last records.")}</p> : null}
      <div className="connection-list">{filtered.map((item) => <ConnectionCard key={item.id} item={item} open={expanded && openGroups.has(item.id)} onToggle={() => toggleGroup(item.id)}
        now={now} stale={stale} reading={!targets.snapshot && !targets.failed}
        unavailable={targetsUnavailable || Boolean(targets.snapshot?.sources && !targets.snapshot.sources.includes(item.protocol === "Hysteria2" ? "hysteria2" : "singbox"))} onCopy={copy} />)}</div>
      {!filtered.length ? <div className="table-empty" role="status"><Icon name={filterPending ? "search" : "link_off"} size={28} />
        <strong>{filterPending ? t("正在查找连接…", "Looking up connections…") : hasFilter ? t("没有符合筛选条件的连接", "No connections match these filters") : t("当前没有可显示的连接", "No connections to show right now")}</strong>
        {hasFilter ? <Button type="button" variant="text" onClick={clearFilters}>{t("清除筛选", "Clear filters")}</Button> : null}
      </div> : null}
      </div>
    </div>
  </TrafficSection>;
}
