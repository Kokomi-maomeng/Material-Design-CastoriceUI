import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "../lib/i18n";
import { networkQuality } from "../lib/network-quality";
import { chartTime } from "../lib/chart-time";
import { percent } from "../lib/format";
import { emptyDashboard } from "../lib/empty-dashboard";
import type { NetworkTarget } from "../lib/types";
import { OverviewPage } from "../components/pages/OverviewPage";
import { NetworkPage } from "../components/pages/NetworkPage";
import { ResourceChart } from "../components/charts/ResourceChart";
import { TrafficChart } from "../components/charts/TrafficChart";
import { SubscriptionsPage } from "../components/pages/SubscriptionsPage";

beforeEach(() => { localStorage.clear(); localStorage.setItem("castorice-language", "en"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const target = (index: number, degraded = false): NetworkTarget => ({ id: `qa-${index}`, name: `QA ${index}`, provider: "Synthetic", address: `192.0.2.${index + 1}`, ipVersion: 4, latency: degraded ? 200 : 1, loss: 0, jitter: 0, status: degraded ? "degraded" : "healthy", history: [], effectivePolicy: { latencyMs: 150, lossPercent: 5, windowSeconds: 120, minimumPackets: 24 } });
const times = ["2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z", "2026-01-01T00:59:00Z"];

describe("v5.1 audit regressions", () => {
  it("gives both pages the same grade without averaging away a bad target", () => {
    const targets = Array.from({ length: 5 }, (_, index) => target(index, index === 0));
    render(<I18nProvider><OverviewPage mode="live" metrics={emptyDashboard.overview} connections={[]} services={[]} networkTargets={targets} traffic={emptyDashboard.traffic} onEditQuota={vi.fn()} onRefresh={vi.fn()} onNavigate={vi.fn()} /></I18nProvider>);
    expect(screen.getByText("Poor")).toBeTruthy();
    cleanup();
    render(<I18nProvider><NetworkPage targets={targets} onToast={vi.fn()} onConfigure={vi.fn()} onSaved={vi.fn()} /></I18nProvider>);
    expect(screen.getAllByText("Poor").length).toBeGreaterThan(0);
    const relaxed = targets.map((item) => ({ ...item, status: "healthy" as const, latency: 200, effectivePolicy: { ...item.effectivePolicy!, latencyMs: 300 } }));
    expect(networkQuality(relaxed)).toBe("excellent");
    expect(networkQuality([{ ...relaxed[0], alertConfirmed: true }])).toBe("recovering");
    expect(networkQuality([{ ...relaxed[0], complete: false }])).toBe("unavailable");
  });

  it("shows actual overuse while keeping the progress bar within its bounds", () => {
    render(<I18nProvider><OverviewPage mode="live" metrics={{ ...emptyDashboard.overview, trafficLimitBytes: 1e12, trafficUsedBytes: 1.5e12 }} connections={[]} services={[]} networkTargets={[]} traffic={emptyDashboard.traffic} onEditQuota={vi.fn()} onRefresh={vi.fn()} onNavigate={vi.fn()} /></I18nProvider>);
    expect(screen.getByText("150% used")).toBeTruthy();
    expect(screen.getByText("500.0 GB over quota")).toBeTruthy();
    const bar = screen.getByRole("progressbar", { name: "Current-cycle traffic usage" });
    expect(bar.getAttribute("aria-valuenow")).toBe("100");
    expect(bar.querySelector("span")?.style.width).toBe("100%");
    expect([percent(1, 0), percent(NaN, 1), percent(1, Infinity)]).toEqual([0, 0, 0]);
  });

  it("positions actual timestamps, splits missing intervals and preserves single samples", () => {
    const timeline = chartTime(times.map((capturedAt) => ({ capturedAt })));
    expect(timeline.ratios[1]).toBeCloseTo(1 / 59);
    expect(timeline.groups).toEqual([[0, 1], [2]]);
    expect(timeline.nearest(1 / 59)).toBe(1);
    const samples = times.map((capturedAt) => ({ capturedAt, cpuPercent: 20, memoryPercent: 40 }));
    const { container } = render(<I18nProvider><ResourceChart data={samples} /></I18nProvider>);
    const path = container.querySelector(".chart-line--primary")?.getAttribute("d") ?? "";
    expect(path).toContain("L55.1,");
    expect(path.match(/M/g)?.length).toBe(2);
    expect(container.querySelectorAll(".chart-point").length).toBe(2);
    cleanup();
    const traffic = render(<I18nProvider><TrafficChart data={times.map((capturedAt) => ({ capturedAt, label: "QA", download: 1, upload: 2 }))} /></I18nProvider>);
    expect(traffic.container.querySelector(".chart-line--primary")?.getAttribute("d")?.match(/M/g)?.length).toBe(2);
    cleanup();
    const single = render(<I18nProvider><ResourceChart data={[samples[0]]} /></I18nProvider>);
    expect(single.container.querySelectorAll(".chart-point").length).toBe(2);
  });

  it("provides a selectable private address after clipboard denial", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(() => false) });
    const url = "https://publisher.example.com/sub/synthetic-only-token";
    render(<I18nProvider><SubscriptionsPage subscriptions={[{ id: "qa", account: "QA operator", protocols: ["AnyTLS"], enabled: true, url }]} onToast={vi.fn()} /></I18nProvider>);
    expect(screen.queryByDisplayValue(url)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Copy URL" }));
    const address = await screen.findByRole("textbox", { name: "Subscription URL" }) as HTMLTextAreaElement;
    expect(address.value).toBe(url);
    fireEvent.focus(address);
    expect(address.selectionStart).toBe(0);
    expect(address.selectionEnd).toBe(url.length);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByDisplayValue(url)).toBeNull();
  });
});
