import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "../lib/api";
import { I18nProvider } from "../lib/i18n";
import { AlertsPage } from "../components/pages/AlertsPage";
import { NetworkPage } from "../components/pages/NetworkPage";
import { ServiceCards } from "../components/ServiceCards";
import { emptyDashboard } from "../lib/empty-dashboard";
import type { AlertItem, NetworkTarget } from "../lib/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
const english = (node: React.ReactNode) => { localStorage.setItem("castorice-language", "en"); return render(<I18nProvider>{node}</I18nProvider>); };

it("distinguishes unavailable evidence from a confirmed offline service", () => {
  const base = { id: "qa", name: "QA", detail: "Synthetic", icon: "shield", version: "QA", kind: "protocol" as const };
  english(<ServiceCards services={[{ ...base, status: "warning", stateReason: "inventory_stale" }, { ...base, id: "offline", name: "Offline QA", status: "stopped", stateReason: "listener_absent" }]} metrics={emptyDashboard.overview} />);
  expect(screen.getByText("Unconfirmed", { exact: true })).toBeTruthy();
  expect(screen.getByText("Offline", { exact: true })).toBeTruthy();
  expect(document.querySelectorAll(".service-card--warning")).toHaveLength(1);
});

it("separates active and recovered pending records without acknowledging them", async () => {
  const active: AlertItem = { id: "qa", episodeId: "qa1", severity: "critical", title: "Active fault", description: "Synthetic", source: "QA", time: "now", startedAt: "2026-01-01T00:00:00Z", acknowledged: false, status: "active" };
  const recovered = { ...active, id: "qa2", episodeId: "qa2", title: "Recovered fault", status: "resolved" as const, resolvedAt: "2026-01-01T00:01:00Z" };
  const fetch = vi.spyOn(api, "fetchAlerts").mockImplementation(async (options) => ({ items: options.status === "active" ? [active] : options.status === "recovered" ? [recovered] : [active, recovered], total: options.filter === "pending" ? 2 : 1, page: 1, pageSize: 50, totalPages: 1, summary: { active: 1, recoveredPending: 1, pending: 2, critical: 2, warning: 0, info: 0 } }));
  const acknowledge = vi.fn();
  english(<AlertsPage alerts={[]} onAcknowledge={acknowledge} onAcknowledgeAll={vi.fn()} onToast={vi.fn()} onConfigure={vi.fn()} />);
  await screen.findByText("Recovered fault");
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.click(await screen.findByRole("button", { name: "Active" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => expect(screen.queryByText("Recovered fault")).toBeNull());
  expect(screen.getByText("Active fault")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Filter · 1" }));
  fireEvent.click(await screen.findByRole("button", { name: "Recovered pending" }));
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await screen.findByText("Recovered fault");
  expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ status: "recovered", filter: "pending" }));
  expect(acknowledge).not.toHaveBeenCalled();
});

it("keeps a single degraded target visible despite healthy averages and labels real history", () => {
  const target: NetworkTarget = { id: "qa", name: "QA", address: "192.0.2.1", provider: "QA", ipVersion: 4, latency: 10, jitter: 0, loss: 12.5, status: "degraded", history: [10, 12], complete: true, effectivePolicy: { latencyMs: 150, lossPercent: 5, windowSeconds: 120, minimumPackets: 24 }, timeHistory: [{ capturedAt: 1700000000, latency: 10, loss: 0, complete: true, status: "healthy" }, { capturedAt: 1700000020, latency: null, loss: null, complete: false, status: "unavailable" }, { capturedAt: 1700000040, latency: 20, loss: 12.5, complete: true, status: "degraded" }] };
  english(<NetworkPage targets={[target, { ...target, id: "healthy", name: "Healthy", status: "healthy", loss: 0, timeHistory: [] }]} onToast={vi.fn()} onConfigure={vi.fn()} onSaved={vi.fn()} />);
  expect(screen.getByText("Poor")).toBeTruthy();
  expect(screen.getAllByText("Replies this round")).toHaveLength(2);
  expect(screen.getAllByText("Measured hour · gaps preserved")).toHaveLength(2);
  expect(document.querySelectorAll('svg[aria-label="QA time trend"] circle')).toHaveLength(4);
  expect(document.querySelectorAll('svg[aria-label="QA time trend"] [data-gap]')).toHaveLength(1);
});

it("keeps inherited thresholds empty when editing a measured target", async () => {
  const target: NetworkTarget = { id: "qa", name: "QA", address: "192.0.2.1", provider: "QA", ipVersion: 4, latency: 10, jitter: 0, loss: 0, status: "healthy", history: [10], latencyMs: 150, lossPercent: 5, thresholdOverrides: {} };
  english(<NetworkPage targets={[target]} onToast={vi.fn()} onConfigure={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Customize" }));
  expect((await screen.findByLabelText("Latency threshold (ms)") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Loss threshold (%)") as HTMLInputElement).value).toBe("");
});
