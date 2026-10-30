import type { AlertPageResponse, AuditPageResponse, BootstrapState, ConnectionTargets, DashboardPayload, IntegrationStatus, LoginAppearance, LoginBackgroundSettings, NetworkHistoryResponse, NetworkTarget, SessionState, TrafficQuotaSettings, UiSettings } from "./types";
import { parseDashboard, validNetworkSamples, validNetworkTarget } from "./dashboard-validation";

const JSON_HEADERS = { "Content-Type": "application/json" };
let csrfToken = "";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string, public field?: string) {
    super(message || code || `API request failed with ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit, mutation = false): Promise<T> {
  const headers: Record<string, string> = { ...JSON_HEADERS, ...(init?.headers as Record<string, string> | undefined) };
  if (mutation) {
    headers["X-CastoriceUI-Request"] = "1";
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  }
  const controller = new AbortController();
  const timeoutMs = path.includes("/dashboard") ? 10_000 : 8_000;
  const timeout = window.setTimeout(() => controller.abort("request_timeout"), timeoutMs);
  const externalSignal = init?.signal;
  if (externalSignal?.aborted) {
    window.clearTimeout(timeout);
    throw new ApiError(499, "request_aborted");
  }
  const abortFromCaller = () => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
  try {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init, headers, signal: controller.signal });
    let body: unknown = null;
    try { body = await response.json(); } catch (error) {
      if (controller.signal.aborted) throw error;
      if (response.ok) throw new ApiError(502, "invalid_response");
    }
    if (!response.ok) {
      const fallbackCodes: Record<number, string> = { 401: "session_expired", 403: "forbidden", 408: "request_timeout", 502: "upstream_unavailable", 503: "service_unavailable", 504: "upstream_timeout" };
      const serverError = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "";
      const error = response.status === 401 && serverError === "authentication_required" ? "session_expired" : serverError || fallbackCodes[response.status] || "request_failed";
      const message = body && typeof body === "object" && "message" in body ? String((body as { message: unknown }).message) : undefined;
      const field = body && typeof body === "object" && "field" in body ? String((body as { field: unknown }).field) : undefined;
      throw new ApiError(response.status, error, message, field);
    }
    if (path.includes("/dashboard")) {
      const parsed = parseDashboard(body);
      if (!parsed) throw new ApiError(502, "invalid_dashboard_response");
      body = parsed;
    }
    return body as T;
  } catch (error) {
    if (controller.signal.aborted && !externalSignal?.aborted) throw new ApiError(408, "request_timeout");
    if (externalSignal?.aborted) throw new ApiError(499, "request_aborted");
    if (error instanceof ApiError) throw error;
    if (error instanceof TypeError) throw new ApiError(0, "network_unavailable");
    throw new ApiError(0, "request_failed");
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function fetchNetworkHistory(targetId: string, hours: 6 | 24, ipVersion: number, signal?: AbortSignal) {
  const body = await request<NetworkHistoryResponse>(`/api/v2/network/${encodeURIComponent(targetId)}/history?hours=${hours}&ipVersion=${ipVersion}`, { signal });
  if (!body || body.targetId !== targetId || body.hours !== hours || !validNetworkSamples(body.samples) || !Number.isFinite(body.start) || !Number.isFinite(body.end) || body.start > body.end) throw new ApiError(502, "invalid_network_history");
  return body;
}

export function reportActivity() {
  return request<{ ok: boolean }>("/api/v2/auth/activity", { method: "POST" }, true);
}

function rememberSession(session: SessionState): SessionState {
  csrfToken = session.csrfToken;
  return session;
}

export function fetchBootstrap(signal?: AbortSignal) {
  return request<BootstrapState>("/api/v2/bootstrap", { signal });
}

export async function fetchSession(signal?: AbortSignal) {
  return rememberSession(await request<SessionState>("/api/v2/auth/session", { signal }));
}

export async function initializeAdministrator(payload: { bootstrapToken: string; username: string; password: string }) {
  return rememberSession(await request<SessionState>("/api/v2/auth/initialize", { method: "POST", body: JSON.stringify(payload) }));
}

export async function login(username: string, password: string) {
  return rememberSession(await request<SessionState>("/api/v2/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }));
}

export async function logout() {
  const result = await request<{ ok: boolean }>("/api/v2/auth/logout", { method: "POST" }, true);
  csrfToken = "";
  return result;
}

export function changePassword(currentPassword: string, newPassword: string) {
  return request<{ ok: boolean }>("/api/v2/auth/change-password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }, true);
}

export function completeInitialization() {
  return request<{ ok: boolean }>("/api/v2/initialization/complete", { method: "POST" }, true);
}

export function fetchDashboard(signal?: AbortSignal) {
  return request<DashboardPayload>("/api/v2/dashboard", { signal });
}

export async function fetchConnectionTargets(signal?: AbortSignal) {
  const body = await request<ConnectionTargets>("/api/v2/connections/targets", { signal });
  if (!body || typeof body.available !== "boolean" || !Array.isArray(body.groups) ||
      !body.groups.every((group) => typeof group.id === "string" && Array.isArray(group.details) && group.details.every((detail) => typeof detail.id === "string" && typeof detail.destination === "string"))) {
    throw new ApiError(502, "invalid_connection_targets");
  }
  return body;
}

export function fetchAudits(options: { page: number; pageSize: 30 | 50; search?: string; category?: string; signal?: AbortSignal }) {
  const query = new URLSearchParams({ page: String(options.page), pageSize: String(options.pageSize) });
  if (options.search) query.set("search", options.search);
  if (options.category) query.set("category", options.category);
  return request<AuditPageResponse>(`/api/v2/audits?${query}`, { signal: options.signal });
}

export function fetchAlerts(options: { page: number; pageSize: 30 | 50; filter: "pending" | "all" | "active" | "recovered"; status?: "" | "active" | "recovered"; severity?: "" | "critical" | "warning" | "info"; start?: string; end?: string; signal?: AbortSignal }) {
  const query = new URLSearchParams({ page: String(options.page), pageSize: String(options.pageSize), filter: options.filter });
  for (const key of ["status", "severity", "start", "end"] as const) if (options[key]) query.set(key, options[key]);
  return request<AlertPageResponse>(`/api/v2/alerts?${query}`, { signal: options.signal });
}

export function fetchSubscriptionUrl(id: string) {
  return request<{ url: string }>(`/api/v2/subscriptions/${encodeURIComponent(id)}/url`);
}

export function updateTrafficLimit(settings: Pick<TrafficQuotaSettings, "bytes"> & Partial<Pick<TrafficQuotaSettings, "autoReset" | "periodUnit" | "periodCount" | "resetAnchor" | "resetTime" | "timezone">>) {
  return request<{ ok: boolean; bytes: number }>("/api/v2/settings/traffic-limit", { method: "PUT", body: JSON.stringify(settings) }, true);
}

export function acknowledgeAlert(id: string) {
  return request<{ ok: boolean }>(`/api/v2/alerts/${encodeURIComponent(id)}/ack`, { method: "POST" }, true);
}

export function acknowledgeAllAlerts() {
  return request<{ ok: boolean; count: number }>("/api/v2/alerts/ack-all", { method: "POST" }, true);
}

export function configureIntegration(id: string, enabled: boolean, values: Record<string, string>) {
  return request<IntegrationStatus>(`/api/v2/integrations/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ enabled, values }) }, true);
}

export function updateNetworkTargets(targets: Array<Pick<NetworkTarget, "name" | "address"> & { order: number; ipVersion?: 0 | 4 | 6 }>, globalThresholds?: { latencyMs: number; lossPercent: number }) {
  return request<{ targets: NetworkTarget[] }>("/api/v2/settings/network-targets", { method: "PUT", body: JSON.stringify({ targets, globalThresholds }) }, true);
}

export async function fetchNetworkTargets(signal?: AbortSignal) {
  const body = await request<{ targets: NetworkTarget[] }>("/api/v2/network", { signal });
  if (!Array.isArray(body?.targets) || body.targets.length > 12 || !body.targets.every(validNetworkTarget)) throw new ApiError(502, "invalid_network_targets");
  return body.targets;
}

export function updateUiSettings(settings: Partial<UiSettings>) {
  return request<UiSettings>("/api/v2/settings/ui", { method: "PUT", body: JSON.stringify(settings) }, true);
}

export function fetchBackgroundOptions() {
  return request<{ files: string[]; directory: string; selected: LoginAppearance; configured: LoginBackgroundSettings }>("/api/v2/settings/background-options");
}

export function updateLoginBackground(settings: LoginBackgroundSettings) {
  return request<LoginAppearance>("/api/v2/settings/login-background", { method: "PUT", body: JSON.stringify(settings) }, true);
}
