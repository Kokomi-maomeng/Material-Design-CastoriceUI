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
