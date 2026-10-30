import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as api from "../lib/api";
import { I18nProvider } from "../lib/i18n";
import { networkHistoryBuckets } from "../lib/network-chart";
import { NetworkChart } from "../components/charts/NetworkChart";
import { NetworkPage } from "../components/pages/NetworkPage";
import type { AlertItem, IntegrationStatus, NetworkTarget } from "../lib/types";

const target: NetworkTarget = { id: "qa", name: "Test node", provider: "Test", address: "192.0.2.1", ipVersion: 4,
  latency: 12.3, jitter: .2, loss: 0, status: "healthy", history: [], observedAt: new Date().toISOString() };
const rules: IntegrationStatus = { id: "alerts", enabled: true, configured: true, status: "ready", summary: "Test", values: { latencyMs: "150", lossPercent: "5", trafficPercent: "80" } };
const renderEnglish = (node: React.ReactNode) => render(<I18nProvider>{node}</I18nProvider>);
beforeEach(() => { localStorage.setItem("castorice-language", "en"); vi.spyOn(api, "fetchNetworkTargets").mockResolvedValue([]); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it("keeps loss at 100% when no echo returns, and labels only actual minimum and maximum RTT", async () => {
  const at = Date.now() / 1000;
  renderEnglish(<NetworkChart label="Probe test" seconds samples={[
    { capturedAt: at - 2, latency: 10.1, loss: 0, complete: true, status: "healthy" },
    { capturedAt: at - 1, latency: 20.3, loss: 0, complete: true, status: "healthy" },
    { capturedAt: at, latency: null, loss: 100, complete: true, status: "down" },
  ]} />);
  const chart = screen.getByRole("img", { name: "Probe test" });
  expect(chart.textContent).toContain("20.3 ms");
  expect(chart.textContent).toContain("10.1 ms");
  expect(chart.querySelectorAll('text.chart-axis-label')).toHaveLength(7);
  expect(chart.querySelector('[data-metric="loss"]')?.getAttribute("points")).toContain(",18");
  fireEvent.focus(chart);
  const tooltip = await screen.findByRole("tooltip");
  expect(tooltip.textContent).toContain(`${new Date(at * 1000).getSeconds()}s`);
  expect(tooltip.textContent).toContain("— ms");
  expect(tooltip.textContent).toContain("100%");
  expect(tooltip.textContent).not.toContain("#");
  fireEvent.keyDown(chart, { key: "ArrowLeft" });
  expect(tooltip.textContent).toContain("20.3 ms");
  fireEvent.blur(chart);
  expect(tooltip.classList.contains("is-leaving")).toBe(true);
  await waitFor(() => expect(screen.queryByRole("tooltip", { hidden: true })).toBeNull());
});

it("uses at most 60 minute buckets without treating gaps as successful samples", () => {
  const samples = Array.from({ length: 180 }, (_, index) => ({ capturedAt: index * 20, latency: index === 178 ? 900 : 10, loss: index === 178 ? 100 : 0,
    complete: index !== 179, status: "healthy" }));
  const buckets = networkHistoryBuckets(samples, 60);
  expect(buckets).toHaveLength(60);
  expect(buckets.at(-1)).toMatchObject({ capturedAt: 3540, latency: 900, loss: 100, hasGaps: true, samples: 3 });
});

it("keeps the tooltip on a real sample when the hovered live point expires", async () => {
  const at = Math.floor(Date.now() / 1000);
  const samples = [
    { capturedAt: at - 1, latency: 10, loss: 0, complete: true, status: "healthy" },
    { capturedAt: at, latency: 20, loss: 10, complete: true, status: "degraded" },
  ];
  const chart = (rows: typeof samples) => <I18nProvider><NetworkChart label="Rolling probes" seconds start={at - 2} end={at + 2} samples={rows} /></I18nProvider>;
  const view = render(chart(samples));
  const plot = screen.getByRole("img", { name: "Rolling probes" });
  fireEvent.focus(plot);
  await screen.findByRole("tooltip");
  fireEvent.keyDown(plot, { key: "Home" });
  expect(screen.getByRole("tooltip").textContent).toContain("10.0 ms");
  view.rerender(chart([samples[1], { ...samples[1], capturedAt: at + 1, latency: 30 }]));
  expect(screen.getByRole("tooltip").textContent).toContain("20.0 ms");
  expect(screen.getByRole("tooltip").textContent).toContain("10%");
  view.rerender(chart([]));
  expect(screen.queryByRole("tooltip")).toBeNull();
});

it("keeps the first partial history bucket inside the requested range", () => {
  const start = 1700000000;
  const buckets = networkHistoryBuckets([{ capturedAt: start + 300, latency: 900, loss: 100, complete: true, status: "down" }], 1440, start);
  expect(buckets[0]).toMatchObject({ capturedAt: start, latency: 900, loss: 100 });
});

it("reserves three compact protocol rows without an expandable evidence section or repetitive prose", () => {
  const { container } = renderEnglish(<NetworkPage targets={[target]} onToast={vi.fn()} onConfigure={vi.fn()} onSaved={async () => {}} alertIntegration={rules} />);
  const card = container.querySelector(".network-target-card")!;
  expect(card.querySelector("details")).toBeNull();
  expect(card.querySelectorAll(".network-probe-readings > div")).toHaveLength(3);
  expect(card.querySelectorAll(".network-probe-readings .is-empty")).toHaveLength(2);
  expect(card.textContent).toContain("ICMP");
  expect(card.textContent).not.toMatch(/Thresholds|window|packets|sampled bucket|saved rounds|Retention|Asia\/|gaps preserved/);
  expect(within(card as HTMLElement).getByText("Network probe")).toBeTruthy();
  expect(within(card as HTMLElement).getByText("Trend history")).toBeTruthy();
});

it("shows configured TCP and DNS rows, retains zero RTT and leaves failed measurements unavailable", () => {
  const { container } = renderEnglish(<NetworkPage targets={[{ ...target, tcpPort: 443, dnsName: "example.com", layers: {
    tcp: { configured: true, status: "passed", durationMs: 0, observedAt: target.observedAt },
    dns: { configured: true, status: "failed", durationMs: 2000, observedAt: target.observedAt },
  } }]} onToast={vi.fn()} onConfigure={vi.fn()} onSaved={async () => {}} />);
  const rows = container.querySelectorAll(".network-probe-readings > div");
  expect(rows[1].textContent).toContain("0.0 ms");
  expect(rows[2].textContent).toContain("DNS(UDP)");
  expect(rows[2].textContent).toContain("— ms");
  expect(rows[2].textContent).not.toContain("2000");
});

it("shows the shared global rules and actual network alerts in one separate card", () => {
  const onOpen = vi.fn();
  const alert: AlertItem = { id: "network-qa", episodeId: "episode", title: "Network delay", description: "RTT 190 ms", severity: "warning", time: "now", acknowledged: false, startedAt: "2026-10-30T00:00:00Z", source: "Test" };
  const { container } = renderEnglish(<NetworkPage targets={[target]} alerts={[alert]} alertIntegration={rules} onOpenAlerts={onOpen} onToast={vi.fn()} onConfigure={vi.fn()} onSaved={async () => {}} />);
  const global = container.querySelector(".network-alerts-card")!;
  expect(global.textContent).toContain("≥ 150 ms");
  expect(global.textContent).toContain("≥ 5%");
  expect(global.textContent).toContain("Network delay");
  fireEvent.click(screen.getByRole("button", { name: "Alert center" }));
  expect(onOpen).toHaveBeenCalledOnce();
});

it("saves global rules with node edits in one request and never submits node threshold overrides", async () => {
  const save = vi.spyOn(api, "updateNetworkTargets").mockResolvedValue({ targets: [] });
  renderEnglish(<NetworkPage targets={[{ ...target, thresholdOverrides: { latencyMs: 321, lossPercent: 7 } }]} alertIntegration={rules} onToast={vi.fn()} onConfigure={vi.fn()} onSaved={async () => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Customize" }));
  await screen.findByRole("dialog");
  expect(screen.getAllByLabelText("Latency threshold (ms)")).toHaveLength(1);
  fireEvent.change(screen.getByLabelText("Latency threshold (ms)"), { target: { value: "240" } });
  fireEvent.change(screen.getByLabelText("Loss threshold (%)"), { target: { value: "8" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][1]).toEqual({ latencyMs: 240, lossPercent: 8 });
  expect(save.mock.calls[0][0][0]).not.toHaveProperty("latencyMs");
  expect(save.mock.calls[0][0][0]).not.toHaveProperty("lossPercent");
});
