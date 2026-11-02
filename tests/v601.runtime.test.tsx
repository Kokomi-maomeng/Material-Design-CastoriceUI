import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as api from "../lib/api";
import { ConnectionsPage } from "../components/pages/ConnectionsPage";
import { NetworkPage } from "../components/pages/NetworkPage";
import { I18nProvider } from "../lib/i18n";
import { matchesConnectionTarget, reconcileLiveConnections, visibleLiveConnections, type ConnectionFilters } from "../lib/connection-view";
import type { AlertItem, Connection, ConnectionTargets } from "../lib/types";

const detail = { id: "flow", destination: null, uploadBps: 12, downloadBps: 34, connectedAt: "2026-11-01T00:00:00Z" };
const group: Connection = { id: "group", protocol: "Trojan", sourceIp: "192.0.2.1", ipVersion: 4, account: "", connections: 1, uploadBps: 12, downloadBps: 34, connectedAt: detail.connectedAt, details: [detail] };
const targets: ConnectionTargets = { available: true, sampledAt: null, groups: [{ id: group.id, details: [{ id: detail.id, destination: "api.example.test:443" }] }] };
const emptyTargets: ConnectionTargets = { available: true, sampledAt: null, groups: [] };
const filters: ConnectionFilters = { ip: "", ipMode: "contains", domain: "", domainMode: "contains", port: "" };
const english = (node: React.ReactNode) => <I18nProvider>{node}</I18nProvider>;
beforeEach(() => { localStorage.setItem("castorice-language", "en"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it("retains a disappeared source and its target for a full thirty seconds without restarting the deadline", () => {
  const live = reconcileLiveConnections([], [group], targets, 1_000);
  const closed = reconcileLiveConnections(live, [], emptyTargets, 2_000);
  expect(closed[0]).toMatchObject({ connections: 0, retained: true, details: [{ closedAt: 2_000, uploadBps: null, destination: "api.example.test:443" }] });
  const polled = reconcileLiveConnections(closed, [], emptyTargets, 20_000);
  expect(polled[0].details[0].closedAt).toBe(2_000);
  expect(visibleLiveConnections(polled, 31_999)).toHaveLength(1);
  expect(visibleLiveConnections(polled, 32_000)).toHaveLength(0);
});

it("retains one closed flow beside active flows, and clears its countdown when it reappears", () => {
  const old = reconcileLiveConnections([], [group], targets, 0);
  const closed = reconcileLiveConnections(old, [{ ...group, details: [] }], emptyTargets, 1_000);
  expect(closed[0].details[0].closedAt).toBe(1_000);
  const reopened = reconcileLiveConnections(closed, [group], targets, 2_000);
  expect(reopened[0].details[0].closedAt).toBeUndefined();
  expect(reopened[0].details[0].downloadBps).toBe(34);
});

it("does not treat unavailable snapshots, unknown entries or racing target data as closures", () => {
  const live = reconcileLiveConnections([], [group], targets, 0);
  expect(reconcileLiveConnections(live, [], { ...emptyTargets, available: false }, 1_000)).toBe(live);
  expect(reconcileLiveConnections(live, [{ ...group, entriesAvailable: false, details: [] }], emptyTargets, 1_000)[0].details[0].closedAt).toBeUndefined();
  expect(reconcileLiveConnections(live, [{ ...group, details: [] }], targets, 1_000)[0].details[0].closedAt).toBeUndefined();
});

it("matches keywords or exact source and destination addresses with IPv6 and domain normalization", () => {
  const flow = { ...detail, destination: "API.Example.Test.:443" };
  expect(matchesConnectionTarget(group.sourceIp, flow, { ...filters, ip: "192.0.2", domain: "EXAMPLE" })).toBe(true);
  expect(matchesConnectionTarget(group.sourceIp, flow, { ...filters, ip: "192.0.2", ipMode: "exact" })).toBe(false);
  expect(matchesConnectionTarget(group.sourceIp, flow, { ...filters, domain: "api.example.test", domainMode: "exact", port: "443" })).toBe(true);
  expect(matchesConnectionTarget(group.sourceIp, flow, { ...filters, domain: "example.test", domainMode: "exact" })).toBe(false);
  expect(matchesConnectionTarget("", { ...detail, destination: "[2001:db8::1]:8443" }, { ...filters, ip: "2001:0db8:0:0:0:0:0:1", ipMode: "exact", port: "8443" })).toBe(true);
  expect(matchesConnectionTarget("", { ...detail, destination: "192.0.2.2:443" }, { ...filters, domain: "192.0.2" })).toBe(false);
});

it("keeps combined domain and port filters on the same flow", () => {
  const combined = { ...filters, domain: "api.example.test", domainMode: "exact" as const, port: "8443" };
  expect(matchesConnectionTarget("", { ...detail, destination: "api.example.test:443" }, combined)).toBe(false);
  expect(matchesConnectionTarget("", { ...detail, destination: "other.example.test:8443" }, combined)).toBe(false);
  expect(matchesConnectionTarget("", { ...detail, destination: "api.example.test:8443" }, combined)).toBe(true);
});

it("animates the filter container, fetches target filters with live display off and preserves hidden drafts", async () => {
  const fetch = vi.spyOn(api, "fetchConnectionTargets").mockResolvedValue(targets);
  const { container } = render(english(<ConnectionsPage connections={[group]} now={Date.now()} onToast={vi.fn()} onConfigure={vi.fn()} />));
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  const query = screen.getByRole("searchbox", { name: "Destination domain" });
  expect(query.closest(".motion-collapse")?.classList.contains("is-expanded")).toBe(true);
  fireEvent.change(query, { target: { value: "api.example.test" } });
  await waitFor(() => expect(fetch).toHaveBeenCalled());
  await waitFor(() => expect(container.querySelectorAll(".connection-card")).toHaveLength(1));
  expect(screen.getByRole("switch", { name: "Show live connections" }).getAttribute("aria-checked")).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "Filters applied" }));
  expect(screen.queryByRole("searchbox", { name: "Destination domain" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Filters applied" }));
  expect(screen.getByRole("searchbox", { name: "Destination domain" })).toHaveProperty("value", "api.example.test");
  fireEvent.change(screen.getByRole("searchbox", { name: "Destination port" }), { target: { value: "8443" } });
  await screen.findByText("No connections match these filters");
});

it("shows a closed countdown instead of open duration and keeps the target through read failures", async () => {
  const fetch = vi.spyOn(api, "fetchConnectionTargets").mockResolvedValue(targets);
  const page = (connections: Connection[], now = Date.now()) => english(<ConnectionsPage connections={connections} now={now} onToast={vi.fn()} onConfigure={vi.fn()} />);
  const view = render(page([group]));
  fireEvent.click(screen.getByRole("switch", { name: "Show live connections" }));
  await screen.findByText("View destinations");
  fireEvent.click(screen.getByText("View destinations"));
  fetch.mockResolvedValue(emptyTargets);
  view.rerender(page([]));
  await waitFor(() => expect(view.container.querySelector(".connection-countdown")?.textContent).toContain("Closed"));
  expect(view.container.querySelector(".connection-target-meta")?.textContent).not.toContain("Open for");
  fetch.mockRejectedValue(new Error("unavailable"));
  view.rerender(page([]));
  await screen.findByText(/Could not read destinations\. Previous records are retained; please retry/);
  expect(view.container.querySelector(".connection-target code")?.textContent).toBe("api.example.test");
  view.rerender(page([], Date.now() + 31_000));
  expect(view.container.querySelector(".connection-target")).toBeNull();
});

const alert: AlertItem = { id: "network-qa", episodeId: "network-episode", title: "RTT high", description: "RTT 200ms", severity: "warning", time: "now", source: "Monitor", acknowledged: false, startedAt: "2026-11-01T00:00:00Z" };
it("keeps a previously visible closed destination on screen beyond the ten-row live page", async () => {
  const details = Array.from({ length: 15 }, (_, i) => ({ ...detail, id: `flow-${i}`, downloadBps: i }));
  const value = (rows: typeof details): ConnectionTargets => ({ available: true, sampledAt: null, groups: [{ id: group.id, details: rows.map((row) => ({ id: row.id, destination: `${row.id}.example.test:443` })) }] });
  const fetch = vi.spyOn(api, "fetchConnectionTargets").mockResolvedValue(value(details));
  const page = (rows: typeof details) => english(<ConnectionsPage connections={[{ ...group, details: rows }]} now={Date.now()} onToast={vi.fn()} onConfigure={vi.fn()} />);
  const view = render(page(details));
  fireEvent.click(screen.getByRole("switch", { name: "Show live connections" }));
  await screen.findByText("View destinations");
  fireEvent.click(screen.getByText("View destinations"));
  await act(async () => { await new Promise(requestAnimationFrame); });
  expect(view.container.querySelectorAll(".connection-target")).toHaveLength(10);
  const current = details.slice(0, -1);
  fetch.mockResolvedValue(value(current));
  view.rerender(page(current));
  await waitFor(() => expect(view.container.querySelector(".connection-target.is-closed code")?.textContent).toBe("flow-14.example.test"));
  expect(view.container.querySelectorAll(".connection-target")).toHaveLength(11);
});

it("shows pending reminders in blue with recovery times and the shared acknowledge action before alert center", async () => {
  vi.spyOn(api, "fetchNetworkTargets").mockResolvedValue([]);
  let done: (() => void) | undefined;
  const acknowledge = vi.fn(() => new Promise<void>((resolve) => { done = resolve; }));
  const props = { targets: [], onToast: vi.fn(), onConfigure: vi.fn(), onSaved: async () => {}, onOpenAlerts: vi.fn(), onAcknowledgeAll: acknowledge };
  const rows = [alert, { ...alert, episodeId: "recovered", resolvedAt: "2026-11-01T01:00:00Z", status: "resolved" as const }, { ...alert, episodeId: "ack", acknowledged: true }];
  const view = render(english(<NetworkPage {...props} alerts={rows} />));
  const card = view.container.querySelector(".network-alerts-card") as HTMLElement;
  expect(card.querySelector(".md-chip--info")?.textContent).toBe("2 reminders");
  expect(within(card).getAllByRole("listitem")).toHaveLength(2);
  expect(card.querySelectorAll('time[datetime="2026-11-01T01:00:00Z"]')).toHaveLength(1);
  expect(within(card).getByText("Active")).toBeTruthy();
  const buttons = within(card).getAllByRole("button");
  expect(buttons[0].textContent).toContain("Acknowledge all");
  fireEvent.click(buttons[0]); fireEvent.click(buttons[0]);
  expect(acknowledge).toHaveBeenCalledOnce();
  done?.();
  await waitFor(() => expect(buttons[0]).toHaveProperty("disabled", false));
  view.rerender(english(<NetworkPage {...props} alerts={rows.map((row) => ({ ...row, acknowledged: true }))} />));
  expect(card.querySelector(".md-chip--info")?.textContent).toBe("0 reminders");
  expect(within(card).queryAllByRole("listitem")).toHaveLength(0);
  expect(buttons[0]).toHaveProperty("disabled", true);
});
