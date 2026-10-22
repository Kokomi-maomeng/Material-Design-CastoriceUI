import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../lib/i18n";
import { emptyDashboard } from "../lib/empty-dashboard";
import { parseDashboard, validDashboard } from "../lib/dashboard-validation";
import { validBackgroundUrl } from "../lib/background-url";
import { fetchDashboard } from "../lib/api";
import { NetworkPage } from "../components/pages/NetworkPage";
import { ServiceCards } from "../components/ServiceCards";
import { IntegrationGate } from "../components/setup/IntegrationGate";
import type { NetworkTarget } from "../lib/types";

beforeEach(() => { localStorage.clear(); localStorage.setItem("castorice-language", "en"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const payload = () => structuredClone({ ...emptyDashboard, mode: "live" });

describe("v5.6 audit regressions", () => {
  it("accepts measured or unknown capacity, rejects invalid capacity, and keeps writable state visible", async () => {
    for (const value of [null, 0, 4096]) {
      const data = payload(); data.overview.databaseBytes = value;
      expect(validDashboard(data)).toBe(true);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
      expect((await fetchDashboard()).overview.databaseBytes).toBe(value);
    }
    const data = payload(); data.overview.databaseBytes = -1;
    expect(validDashboard(data)).toBe(false);
    render(<I18nProvider><ServiceCards metrics={{ ...emptyDashboard.overview, databaseBytes: null, databaseWritable: true }} services={[]} /></I18nProvider>);
    expect(screen.getByText(/Sample write succeeded · size unavailable/i)).toBeTruthy();
  });

  it("isolates invalid alert rows while rejecting corrupted critical measurements", async () => {
    const good = { id: "capacity", title: "Storage", description: "Synthetic", source: "Storage", severity: "warning", time: "2026-01-01T00:00:00Z", acknowledged: false };
    const data = { ...payload(), alerts: [good, { ...good, id: "legacy", time: undefined }, null] };
    const result = parseDashboard(data);
    expect(result?.alerts).toEqual([good]);
    expect(result?.rejectedAlertCount).toBe(2);
    expect(parseDashboard({ ...data, overview: { ...data.overview, cpuPercent: "broken" } })).toBeNull();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => data }));
    expect((await fetchDashboard()).rejectedAlertCount).toBe(2);
  });

  it("shows partial connection coverage without claiming the source is unconfigured", () => {
    render(<I18nProvider><IntegrationGate status={{ id: "connections", enabled: true, configured: true, status: "partial", summary: "Connection sources responding: 1/2" }} name="Connections" onConfigure={vi.fn()} description="Configure sources" /></I18nProvider>);
    expect(screen.getByText("Connections partially available")).toBeTruthy();
    expect(screen.queryByText("Connections is not configured")).toBeNull();
  });

  it("retains pending custom thresholds and protocol options on immediate rename, then supports explicit clearing", async () => {
    const target: NetworkTarget = { id: "qa", name: "Synthetic DNS", provider: "Synthetic", address: "2606:4700:4700::1111", ipVersion: 6, order: 1, latency: null, loss: null, jitter: null, history: [], status: "unavailable", thresholdOverrides: { latencyMs: 321, lossPercent: 7 }, tcpPort: 443, dnsPort: 53, dnsName: "example.com" };
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }); vi.stubGlobal("fetch", fetcher);
    render(<I18nProvider><NetworkPage targets={[target]} onToast={vi.fn()} onConfigure={vi.fn()} onSaved={vi.fn().mockResolvedValue(undefined)} /></I18nProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    fireEvent.change(await screen.findByDisplayValue("Synthetic DNS"), { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(fetcher).toHaveBeenCalled());
    const saved = JSON.parse(fetcher.mock.calls[0][1].body).targets[0];
    expect(saved).toMatchObject({ name: "Renamed", latencyMs: 321, lossPercent: 7, tcpPort: 443, dnsPort: 53, dnsName: "example.com", ipVersion: 6 });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Customize" }));
    fireEvent.change(await screen.findByDisplayValue("321"), { target: { value: "" } });
    fireEvent.change(screen.getByDisplayValue("7"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /Save/ }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    const cleared = JSON.parse(fetcher.mock.calls[1][1].body).targets[0];
    expect(cleared.latencyMs).toBeUndefined(); expect(cleared.lossPercent).toBeUndefined();
    expect(cleared.tcpPort).toBe(443);
  });

  it("uses the same background URL port boundaries before submitting", () => {
    expect(validBackgroundUrl("https://images.example.com:?random=1")).toBe(false);
    for (const port of ["", "letters", "0", "65536", "-1"]) expect(validBackgroundUrl(`https://images.example.com:${port}/random`)).toBe(false);
    for (const url of ["https://images.example.com/random", "https://images.example.com:443/random", "https://images.example.com:8443/random", "https://[2606:4700:4700::1111]:8443/random"]) expect(validBackgroundUrl(url)).toBe(true);
  });
});
