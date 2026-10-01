import { emptyDashboard } from "./empty-dashboard";
import type { DashboardPayload } from "./types";

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value);

function matches(value: unknown, template: unknown): boolean {
  if (Array.isArray(template)) return Array.isArray(value);
  if (template === null) return value === null || typeof value === "string";
  if (object(template)) return object(value) && Object.entries(template).every(([key, expected]) => matches(value[key], expected));
  return typeof template === "number" ? finite(value) : typeof value === typeof template;
}

export function validDashboard(value: unknown): value is DashboardPayload {
  if (!object(value) || !["live", "stale"].includes(String(value.mode))) return false;
  // The wire contract omits optional quota metadata on older installations.
  const { trafficQuota: _optionalQuota, ...overview } = emptyDashboard.overview;
  const template = { ...emptyDashboard, overview };
  if (!matches(value, template) || !Number.isFinite(Date.parse(String(value.generatedAt)))) return false;
  const rows = (key: string, required: string[], arrays: string[] = [], numbers: string[] = []) => Array.isArray(value[key]) && value[key].every((row: unknown) => object(row) && required.every((field) => typeof row[field] === "string") && arrays.every((field) => Array.isArray(row[field])) && numbers.every((field) => finite(row[field])));
  if (!rows("accounts", ["id", "name", "email", "status", "expiresAt"], ["protocols"], ["usedBytes", "quotaBytes", "onlineDevices"]) || !rows("connections", ["id", "protocol", "account", "sourceIp"], ["details"], ["connections"]) || !rows("networkTargets", ["id", "name", "address", "status"], ["history"]) || !rows("services", ["id", "name", "detail", "status", "version", "icon"]) || !rows("alerts", ["id", "title", "description", "severity", "source"]) || !rows("integrations", ["id", "summary", "status"]) || !rows("subscriptions", ["id", "account"], ["protocols"])) return false;
  const nullableNumber = (item: unknown) => item === null || finite(item);
  const nullableString = (item: unknown) => item === null || typeof item === "string";
  const every = (key: string, check: (row: Record<string, unknown>) => boolean) => (value[key] as Record<string, unknown>[]).every(check);
  const protocols = (row: Record<string, unknown>) => (row.protocols as unknown[]).every((item) => typeof item === "string");
  const rate = (row: Record<string, unknown>) => nullableNumber(row.uploadBps) && nullableNumber(row.downloadBps) && nullableString(row.connectedAt) && (row.destination === undefined || nullableString(row.destination));
  if (!every("accounts", protocols) || !every("subscriptions", (row) => protocols(row) && typeof row.enabled === "boolean")) return false;
  if (!every("connections", (row) => rate(row) && [4, 6, null].includes(row.ipVersion as number | null) && (row.details as unknown[]).every((item) => object(item) && typeof item.id === "string" && rate(item)))) return false;
  if (!every("networkTargets", (row) => typeof row.provider === "string" && [0, 4, 6].includes(Number(row.ipVersion)) && ["healthy", "degraded", "down", "unavailable"].includes(String(row.status)) && nullableNumber(row.latency) && nullableNumber(row.jitter) && nullableNumber(row.loss) && (row.history as unknown[]).every(finite))) return false;
  if (!every("alerts", (row) => typeof row.time === "string" && typeof row.acknowledged === "boolean" && ["critical", "warning", "info"].includes(String(row.severity)))) return false;
  if (!every("services", (row) => ["running", "warning", "stopped"].includes(String(row.status)))) return false;
  if (!every("integrations", (row) => typeof row.enabled === "boolean" && typeof row.configured === "boolean" && (row.values === undefined || object(row.values) && Object.values(row.values).every((item) => typeof item === "string")))) return false;
  const metrics = value.overview as Record<string, unknown>;
  if (!Array.isArray(metrics.load) || metrics.load.length !== 3 || !metrics.load.every(finite)) return false;
  const quota = metrics.trafficQuota;
  if (quota !== undefined) {
    if (!object(quota) || !matches(quota, _optionalQuota)) return false;
    try { new Intl.DateTimeFormat("en", { timeZone: String(quota.timezone) }); } catch { return false; }
    if (quota.nextReset !== null && !Number.isFinite(Date.parse(String(quota.nextReset)))) return false;
  }
  const traffic = value.traffic as Record<string, unknown>;
  const ranges = traffic.ranges as Record<string, unknown>;
  const seriesValid = (series: unknown) => Array.isArray(series) && series.every((point) => object(point) && typeof point.label === "string" && finite(point.upload) && finite(point.download));
  if (!Object.values(ranges).every(seriesValid) || !seriesValid(traffic.hourly) || !seriesValid(traffic.daily)) return false;
  if (!(traffic.monthly as unknown[]).every((item) => object(item) && typeof item.startDate === "string" && typeof item.endDate === "string" && finite(item.bytes))) return false;
  for (const key of ["protocol", "account"]) if (!(traffic[key] as unknown[]).every((item) => object(item) && typeof item.name === "string" && finite(item.value))) return false;
  const resources = value.resourceHistory as Record<string, unknown>;
  if (!Object.values(resources).every((series) => Array.isArray(series) && series.every((point) => object(point) && typeof point.capturedAt === "string" && finite(point.cpuPercent) && finite(point.memoryPercent)))) return false;
  const ui = value.uiSettings as Record<string, unknown>;
  return [2, 5, 10, 15, 20, 30].includes(Number(ui.idleTimeoutMinutes)) && (ui.visiblePanels as unknown[]).every((id) => typeof id === "string");
}
