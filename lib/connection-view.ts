import type { Connection } from "./types";

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
