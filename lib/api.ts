import type { DashboardPayload } from "./types";

const JSON_HEADERS = { "Content-Type": "application/json" };
const MUTATION_HEADERS = { "X-CastoriceUI-Request": "1" };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: { ...JSON_HEADERS, ...init?.headers },
  });
  if (!response.ok) throw new Error(`API request failed with ${response.status}`);
  return response.json() as Promise<T>;
}

export function fetchDashboard(signal?: AbortSignal) {
  return request<DashboardPayload>("/api/v1/dashboard", { signal });
}

export function fetchSubscriptionUrl(id: string) {
  return request<{ url: string }>(`/api/v1/subscriptions/${encodeURIComponent(id)}/url`);
}

export function updateTrafficLimit(bytes: number) {
  return request<{ ok: boolean }>("/api/v1/settings/traffic-limit", {
    method: "PUT",
    headers: MUTATION_HEADERS,
    body: JSON.stringify({ bytes }),
  });
}

export function acknowledgeAlert(id: string) {
  return request<{ ok: boolean }>(`/api/v1/alerts/${encodeURIComponent(id)}/ack`, { method: "POST", headers: MUTATION_HEADERS });
}

export function configureIntegration(id: string, enabled: boolean, values: Record<string, string>) {
  return request<{ id: string; enabled: boolean; configured: boolean; status: string; summary: string }>(
    `/api/v1/integrations/${encodeURIComponent(id)}`,
    { method: "PUT", headers: MUTATION_HEADERS, body: JSON.stringify({ enabled, values }) },
  );
}
