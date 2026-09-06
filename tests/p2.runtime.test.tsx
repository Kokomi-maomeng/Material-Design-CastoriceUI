import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import { AuthPage } from "../components/auth/AuthPage";
import { ConnectionsPage } from "../components/pages/ConnectionsPage";
import { AccountsPage } from "../components/pages/AccountsPage";
import { AlertsPage } from "../components/pages/AlertsPage";
import { TrafficChart } from "../components/charts/TrafficChart";
import { fetchDashboard } from "../lib/api";
import type { Account, AlertItem, Connection, TrafficPoint } from "../lib/types";

const renderEnglish = (node: ReactNode) => {
  localStorage.setItem("castorice-language", "en");
  return render(<I18nProvider>{node}</I18nProvider>);
};

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("P2 truthfulness and interaction regressions", () => {
  it("keeps the traffic chart usable when a selected series shrinks and grows", () => {
    const points = (count: number): TrafficPoint[] => Array.from({ length: count }, (_, index) => ({
      label: String(index), capturedAt: new Date(1_700_000_000_000 + index * 60_000).toISOString(), upload: index, download: index + 1,
    }));
    const { container, rerender } = renderEnglish(<TrafficChart data={points(24)} />);
    const chart = container.querySelector("svg") as SVGSVGElement;
    fireEvent.focus(chart);
    fireEvent.keyDown(chart, { key: "End" });
    rerender(<I18nProvider><TrafficChart data={points(1)} /></I18nProvider>);
    expect(container.querySelector(".chart--traffic")).toBeTruthy();
    rerender(<I18nProvider><TrafficChart data={[]} /></I18nProvider>);
    expect(screen.getByRole("status")).toBeTruthy();
    rerender(<I18nProvider><TrafficChart data={points(24)} /></I18nProvider>);
    expect(container.querySelector(".chart--traffic")).toBeTruthy();
  });

  it("isolates a malformed chart refresh and recovers on the next valid sample", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = [undefined] as unknown as TrafficPoint[];
    const { container, rerender } = renderEnglish(<TrafficChart data={broken} />);
    expect(screen.getByRole("alert").textContent).toContain("other pages remain usable");
    rerender(<I18nProvider><TrafficChart data={[{ label: "ok", upload: 1, download: 2 }]} /></I18nProvider>);
    expect(container.querySelector('[role="region"][aria-label="Upload and download traffic trend"]')).toBeTruthy();
  });

  it("does not present wholly unknown connection rates as zero", () => {
    const connection: Connection = {
      id: "unknown", protocol: "Hysteria2", account: "", sourceIp: "", ipVersion: null,
      connections: 1, uploadBps: null, downloadBps: null, connectedAt: null, details: [],
    };
    renderEnglish(<ConnectionsPage connections={[connection]} now={Date.now()} onToast={vi.fn()} onConfigure={vi.fn()} />);
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("0 B/s")).toBeNull();
    expect(screen.getByText("1 unknown identity")).toBeTruthy();
  });

  it("shows a field-specific initialization error instead of a service outage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "invalid_username", field: "username" }),
    }));
    renderEnglish(<AuthPage bootstrap={{ setupRequired: true, bootstrapAvailable: true, appearance: { type: "default", url: "", fit: "cover", position: "center" } }} onAuthenticated={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Username" }), { target: { value: "中文用户" } });
    const password = screen.getByLabelText("Password");
    fireEvent.change(password, { target: { value: "Valid-Password-123" } });
    fireEvent.change(screen.getByLabelText("One-time bootstrap token"), { target: { value: "one-time-token" } });
    fireEvent.click(screen.getByRole("button", { name: "Create and continue" }));
    await waitFor(() => expect(screen.getByText(/letters, numbers, dots, hyphens, and underscores/)).toBeTruthy());
    expect(screen.queryByText(/service is unavailable/)).toBeNull();
  });

  it("labels partially observed connection rates even when the known sum is real zero", () => {
    const connection: Connection = {
      id: "partial", protocol: "Hysteria2", account: "alice", sourceIp: "", ipVersion: null,
      connections: 2, uploadBps: 0, downloadBps: 0, connectedAt: null, details: [],
      ratesPartial: true, rateCoverage: { known: 1, total: 2 },
    };
    renderEnglish(<ConnectionsPage connections={[connection]} now={Date.now()} onToast={vi.fn()} onConfigure={vi.fn()} />);
    expect(screen.getAllByText(/0 B\/s \(partial, 1\/2\)/).length).toBeGreaterThanOrEqual(2);
  });

  it("does not compare lifetime protocol counters with a billing-cycle quota", () => {
    const account: Account = {
      id: "a", name: "Alice", email: "", status: "registered", configuredStatus: "active",
      expiryStatus: "notConfigured", coreEvidence: "observed", protocols: ["Hysteria2"],
      usedBytes: 90, quotaBytes: 100, expiresAt: "", onlineDevices: 1, usageSource: "protocolCounter",
    };
    renderEnglish(<AccountsPage accounts={[account]} onConfigure={vi.fn()} />);
    expect(screen.getAllByText("Registered enabled").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: "Registered enabled" })).toBeTruthy();
    expect(screen.getByText(/Different accounting scopes; no percentage shown/)).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("renders durable alert event timestamps instead of payload-relative words", () => {
    const alert: AlertItem = {
      id: "service-nginx", episodeId: "episode", severity: "critical", title: "Nginx is offline",
      description: "offline", time: "now", acknowledged: true, status: "resolved",
      startedAt: "2026-01-01T01:02:03+00:00", resolvedAt: "2026-01-01T01:03:03+00:00",
      acknowledgedAt: "2026-01-01T01:02:33+00:00", source: "Service monitor",
    };
    renderEnglish(<AlertsPage alerts={[alert]} onAcknowledge={vi.fn()} onToast={vi.fn()} onConfigure={vi.fn()} />);
    fireEvent.click(screen.getByText("All records"));
    expect(screen.getByText(/Started.*2026/)).toBeTruthy();
    expect(screen.getByText(/Recovered.*2026/)).toBeTruthy();
    expect(screen.getByText(/Acknowledged.*2026/)).toBeTruthy();
    expect(screen.queryByText("now")).toBeNull();
  });

  it("aborts immediately for a signal that was already aborted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort("caller_cancelled");
    await expect(fetchDashboard(controller.signal)).rejects.toMatchObject({ code: "request_aborted" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps timeout, offline, session, forbidden, and upstream failures distinct", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new TypeError("offline")));
    await expect(fetchDashboard()).rejects.toMatchObject({ code: "network_unavailable" });
    for (const [status, code] of [[401, "session_expired"], [403, "forbidden"], [502, "upstream_unavailable"]] as const) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status, json: async () => { throw new Error("not json"); } }));
      await expect(fetchDashboard()).rejects.toEqual(expect.objectContaining({ code }));
    }
  });
});
