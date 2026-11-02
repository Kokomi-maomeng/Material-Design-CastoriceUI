import type { Connection, ConnectionDetail, ConnectionTargets } from "./types";

export const CLOSED_CONNECTION_RETENTION_MS = 30_000;
export type LiveDetail = ConnectionDetail & { destination: string; closedAt?: number };
export type LiveConnection = Omit<Connection, "details"> & { details: LiveDetail[]; retained?: boolean };
export type ConnectionFilters = { ip: string; ipMode: "contains" | "exact"; domain: string; domainMode: "contains" | "exact"; port: string };

/** Only successful snapshots can mark a previously observed flow as closed. */
export function reconcileLiveConnections(previous: LiveConnection[], connections: Connection[], targets: ConnectionTargets, now: number): LiveConnection[] {
  if (!targets.available) return previous;
  const oldGroups = new Map(previous.map((group) => [group.id, group]));
  const currentGroups = new Map(connections.map((group) => [group.id, group]));
  const result: LiveConnection[] = [];
  for (const id of new Set([...currentGroups.keys(), ...oldGroups.keys()])) {
    const current = currentGroups.get(id), old = oldGroups.get(id);
    const destinations = new Map(targets.groups.find((group) => group.id === id)?.details.map((detail) => [detail.id, detail.destination]));
    const currentDetails = new Map(current?.details.map((detail) => [detail.id, detail]));
    const oldDetails = new Map(old?.details.map((detail) => [detail.id, detail]));
    const details: LiveDetail[] = [];
    for (const detailId of new Set([...currentDetails.keys(), ...oldDetails.keys()])) {
      const detail = currentDetails.get(detailId), before = oldDetails.get(detailId);
      const destination = destinations.get(detailId) ?? before?.destination;
      if (detail && destination) details.push({ ...detail, destination });
      else if (before) {
        // Missing entries or a racing target sample are not evidence of closure.
        if (current?.entriesAvailable === false || destinations.has(detailId)) details.push(before);
        else {
          const closedAt = before.closedAt ?? now;
          if (now - closedAt < CLOSED_CONNECTION_RETENTION_MS) details.push({ ...before, uploadBps: null, downloadBps: null, closedAt });
        }
      }
    }
    if (current) result.push({ ...current, details });
    else if (old && details.length) result.push({ ...old, connections: 0, onlineClients: 0, connectedAt: null, uploadBps: null, downloadBps: null, details, retained: true });
  }
  return result;
}

export function visibleLiveConnections(groups: LiveConnection[], now: number): LiveConnection[] {
  return groups.flatMap((group) => {
    const details = group.details.filter((detail) => detail.closedAt === undefined || now - detail.closedAt < CLOSED_CONNECTION_RETENTION_MS);
    return group.retained && !details.length ? [] : [{ ...group, details }];
  });
}

const normalizedAddress = (value: string) => value.trim().toLocaleLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
const isIp = (value: string) => value.includes(":") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value);
function matchesAddress(value: string, query: string, mode: "contains" | "exact") {
  const address = normalizedAddress(value), term = normalizedAddress(query);
  if (mode === "exact" && isIp(address) && isIp(term)) {
    try { return new URL(`http://${address.includes(":") ? `[${address}]` : address}`).hostname === new URL(`http://${term.includes(":") ? `[${term}]` : term}`).hostname; }
    catch { return address === term; }
  }
  return mode === "exact" ? address === term : address.includes(term);
}

/** Combined target filters must match the same flow, including retained flows. */
export function matchesConnectionTarget(sourceIp: string, detail: ConnectionDetail | undefined, filters: ConnectionFilters): boolean {
  const { address, port } = connectionDestination(detail?.destination ?? "");
  return (!filters.ip.trim() || Boolean(sourceIp && matchesAddress(sourceIp, filters.ip, filters.ipMode)) || isIp(address) && matchesAddress(address, filters.ip, filters.ipMode))
    && (!filters.domain.trim() || Boolean(address && !isIp(address) && matchesAddress(address, filters.domain, filters.domainMode)))
    && (!filters.port.trim() || port === filters.port.trim());
}

/** Rates always describe listed connections; never substitute interface traffic. */
export function listedRate(connections: Connection[], direction: "downloadBps" | "uploadBps"): number | null {
  const known = connections.flatMap((item) => item[direction] === null ? [] : [item[direction]]);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

export function connectionDuration(start: string | null, now: number): number | null {
  const seconds = start ? (now - Date.parse(start)) / 1000 : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** Keep endpoint syntax in transport data; present address and port separately. */
export function connectionDestination(value: string): { address: string; port: string | null } {
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(value);
  if (bracketed) return { address: bracketed[1], port: bracketed[2] ?? null };
  const endpoint = /^([^:]+):(\d+)$/.exec(value);
  return endpoint ? { address: endpoint[1], port: endpoint[2] } : { address: value, port: null };
}
