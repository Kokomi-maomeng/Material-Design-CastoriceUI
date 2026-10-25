import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "../lib/api";
import { alertBadge } from "../lib/alert-badge";
import { connectionDuration, listedRate } from "../lib/connection-view";
import { I18nProvider } from "../lib/i18n";
import { ConnectionsPage } from "../components/pages/ConnectionsPage";
import type { AlertItem, Connection, ConnectionTargets } from "../lib/types";

const entry = (id = "a", protocol: Connection["protocol"] = "Hysteria2"): Connection => ({ id, protocol, account: "", sourceIp: "", ipVersion: null, connections: 100, onlineClients: protocol === "Hysteria2" ? 4 : undefined, connectedAt: "2026-01-01T00:00:00Z", downloadBps: null, uploadBps: 0, details: Array.from({ length: 100 }, (_, i) => ({ id: `${id}-${i}`, destination: null, connectedAt: null, downloadBps: i, uploadBps: 0 })) });
const view = (connections: Connection[], stale = false) => <I18nProvider><ConnectionsPage connections={connections} stale={stale} now={Date.parse("2026-01-02T00:00:00Z")} onToast={vi.fn()} onConfigure={vi.fn()} /></I18nProvider>;
beforeEach(() => { localStorage.clear(); localStorage.setItem("castorice-language", "en"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("v5.7 connection product regressions", () => {
  it("uses full severity summaries and never counts reminders or acknowledged records as numbers", () => {
    for (const [critical, warning, info, expected] of [[0, 0, 0, 0], [0, 0, 8, 0], [0, 9, 20, 9], [3, 2, 90, 5], [100, 7, 1, 107]]) {
      expect(alertBadge({ pending: critical + warning + info, critical, warning, info }, []).count).toBe(expected);
    }
    const alert = { severity: "info", acknowledged: false } as AlertItem;
    expect(alertBadge(undefined, [alert, { ...alert, severity: "critical", acknowledged: true }, { ...alert, severity: "warning" }])).toEqual({ count: 1, critical: 0, reminders: 1 });
  });

  it("omits empty fields, anonymous details and misleading quantities even with 100 entries", () => {
    const { container } = render(view([entry()]));
    expect(container.querySelectorAll(".connection-card")).toHaveLength(1);
    expect(container.querySelectorAll(".connection-target, .connection-disclosure, .connection-address, .connection-account, table")).toHaveLength(0);
    expect(screen.getByText("4 online clients")).toBeTruthy();
    expect(screen.getByText("100 TCP connections")).toBeTruthy();
    expect(screen.queryByText(/unknown identit|Connection groups|partial,|Not provided by core/)).toBeNull();
  });

  it("preserves protocol filters through disappearance and offers an accurate empty-state reset", async () => {
    const { rerender } = render(view([entry("a"), entry("b", "AnyTLS")]));
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Protocol" }));
    fireEvent.click(await screen.findByRole("option", { name: "AnyTLS" }));
    rerender(view([entry("a")]));
    expect(screen.getByText("No connections match these filters")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Clear filters" })[0]);
    expect(screen.getByText("100 TCP connections")).toBeTruthy();
  });

  it("requests no targets by default, pages by rate, searches, and discards a late result after hiding", async () => {
    const a = entry();
    const response: ConnectionTargets = { available: true, sampledAt: null, groups: [{ id: a.id, details: a.details.map((d) => ({ id: d.id, destination: `target-${d.id}.example.test:443` })) }] };
    let resolve: (value: ConnectionTargets) => void = () => {};
    const request = vi.spyOn(api, "fetchConnectionTargets").mockResolvedValueOnce(response).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    const { container } = render(view([a]));
    expect(request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "View live destinations" }));
    await waitFor(() => expect(container.querySelectorAll(".connection-target")).toHaveLength(10));
    expect(container.querySelector(".connection-target code")?.textContent).toBe("target-a-99.example.test:443");
    fireEvent.click(screen.getByRole("button", { name: "Show 10 more" }));
    expect(container.querySelectorAll(".connection-target")).toHaveLength(20);
    fireEvent.change(screen.getByRole("searchbox", { name: "Find destination" }), { target: { value: "target-a-42." } });
    expect(container.querySelectorAll(".connection-target")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Hide live destinations" }));
    fireEvent.click(screen.getByRole("button", { name: "View live destinations" }));
    fireEvent.click(screen.getByRole("button", { name: "Hide live destinations" }));
    resolve(response);
    await waitFor(() => expect(container.querySelectorAll(".connection-target")).toHaveLength(0));
  });

  it("hides live rates, client claims and target details on stale data", () => {
    const { container } = render(view([{ ...entry(), downloadBps: 123 }], true));
    expect(screen.queryByText("4 online clients")).toBeNull();
    expect(container.querySelectorAll(".connection-disclosure")).toHaveLength(0);
    expect(container.querySelector(".connection-card-rates")?.textContent).toBe("↓ —↑ —");
  });

  it("never substitutes unknown sample rates with zero or adds connection durations", () => {
    expect(listedRate([entry()], "downloadBps")).toBeNull();
    expect(listedRate([entry()], "uploadBps")).toBe(0);
    expect(connectionDuration("broken", Date.now())).toBeNull();
    expect(connectionDuration("2999-01-01", Date.now())).toBeNull();
  });
});
