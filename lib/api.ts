import type { BootstrapState, DashboardPayload, IntegrationStatus, LoginAppearance, NetworkTarget, SessionState, UiSettings } from "./types";

const JSON_HEADERS = { "Content-Type": "application/json" };
let csrfToken = "";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message || code || `API request failed with ${status}`);
  }
}

async function request<T>(path: string, init?: RequestInit, mutation = false): Promise<T> {
  const headers: Record<string, string> = { ...JSON_HEADERS, ...(init?.headers as Record<string, string> | undefined) };
  if (mutation) {
    headers["X-CastoriceUI-Request"] = "1";
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
  }
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init, headers });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* A proxy error may not be JSON. */ }
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "request_failed";
    throw new ApiError(response.status, error);
  }
  return body as T;
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

export function completeInitialization() {
  return request<{ ok: boolean }>("/api/v2/initialization/complete", { method: "POST" }, true);
}

export function fetchDashboard(signal?: AbortSignal) {
  return request<DashboardPayload>("/api/v2/dashboard", { signal });
}

export function fetchSubscriptionUrl(id: string) {
  return request<{ url: string }>(`/api/v2/subscriptions/${encodeURIComponent(id)}/url`);
}

export function updateTrafficLimit(bytes: number) {
  return request<{ ok: boolean; bytes: number }>("/api/v2/settings/traffic-limit", { method: "PUT", body: JSON.stringify({ bytes }) }, true);
}

export function acknowledgeAlert(id: string) {
  return request<{ ok: boolean }>(`/api/v2/alerts/${encodeURIComponent(id)}/ack`, { method: "POST" }, true);
}

export function configureIntegration(id: string, enabled: boolean, values: Record<string, string>) {
  return request<IntegrationStatus>(`/api/v2/integrations/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ enabled, values }) }, true);
}

export function updateNetworkTargets(targets: Array<Pick<NetworkTarget, "name" | "address"> & { order: number }>) {
  return request<{ targets: NetworkTarget[] }>("/api/v2/settings/network-targets", { method: "PUT", body: JSON.stringify({ targets }) }, true);
}

export function updateUiSettings(settings: Partial<UiSettings>) {
  return request<UiSettings>("/api/v2/settings/ui", { method: "PUT", body: JSON.stringify(settings) }, true);
}

export function fetchBackgroundOptions() {
  return request<{ files: string[]; selected: LoginAppearance; configured: { type: "default" | "url" | "server"; value: string } }>("/api/v2/settings/background-options");
}

export function updateLoginBackground(type: "default" | "url" | "server", value: string) {
  return request<LoginAppearance>("/api/v2/settings/login-background", { method: "PUT", body: JSON.stringify({ type, value }) }, true);
}
