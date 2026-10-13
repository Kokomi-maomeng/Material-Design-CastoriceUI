import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "../lib/api";
import { I18nProvider } from "../lib/i18n";
import { AlertEvidenceDialog } from "../components/pages/AlertEvidenceDialog";
import { NetworkHistory, TimeTrend } from "../components/pages/NetworkHistory";
import { NetworkDiagnosis } from "../components/pages/NetworkDiagnosis";
import type { AlertItem, NetworkTarget } from "../lib/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
const english = (node: React.ReactNode) => { localStorage.setItem("castorice-language", "en"); return render(<I18nProvider>{node}</I18nProvider>); };
const alert: AlertItem = { id: "qa", episodeId: "qa-episode", severity: "warning", title: "Synthetic", description: "Synthetic", source: "QA", time: "now", acknowledged: false, status: "resolved", startedAt: "2026-01-01T00:00:00Z" };
const target: NetworkTarget = { id: "qa", name: "QA", address: "192.0.2.1", ipVersion: 4, provider: "QA", latency: 10, loss: 0, jitter: 0, status: "healthy", history: [], timeHistory: [] };

it("opens immutable first, worst and latest episode samples and aborts on close", async () => {
  const sample = (loss: number) => ({ title: "Synthetic loss", description: "Synthetic", evidence: { loss, sent: 8, received: 7, complete: true, observedAt: "2026-01-01T00:00:00Z" } });
  const fetch = vi.spyOn(api, "fetchAlertEvidence").mockResolvedValue({ episodeId: alert.episodeId, available: true, first: sample(10), worst: sample(30), last: sample(15), updatedAt: "2026-01-01T00:00:00Z" });
  const view = english(<AlertEvidenceDialog alert={alert} onClose={vi.fn()} />);
  await screen.findByText("Worst reading");
  expect(screen.getByText("10%")).toBeTruthy(); expect(screen.getByText("30%")).toBeTruthy(); expect(screen.getByText("15%")).toBeTruthy();
  const signal = fetch.mock.calls[0][1]; view.unmount(); expect(signal?.aborted).toBe(true);
});

it("does not draw a missing round as normal or hide 100 percent loss when RTT is null", () => {
  english(<TimeTrend label="QA trend" samples={[{ capturedAt: 0, latency: 10, loss: 0, complete: true, status: "healthy" }, { capturedAt: 20, latency: null, loss: 100, complete: true, status: "down" }, { capturedAt: 40, latency: null, loss: null, complete: false, status: "unavailable" }, { capturedAt: 60, latency: 20, loss: 0, complete: true, status: "healthy" }]} />);
  const chart = screen.getByRole("img", { name: "QA trend" });
  expect(chart.querySelectorAll('[data-metric="latency"]')).toHaveLength(2);
  expect(chart.querySelector('[data-metric="loss"]')?.getAttribute("points")).toContain(",12");
  expect(chart.querySelectorAll('[data-gap]')).toHaveLength(1);
});

it("loads day history only on demand, keeps family and maxima, supports retry", async () => {
  const fetch = vi.spyOn(api, "fetchNetworkHistory").mockRejectedValueOnce(new Error("synthetic")).mockResolvedValue({ targetId: "qa", hours: 24, ipVersion: 4, start: 0, end: 86400, granularitySeconds: 300, aggregation: "maximum", sourceSamples: 2, truncated: false, samples: [{ capturedAt: 300, latency: 900, loss: 100, complete: true, status: "down", hasGaps: true }] });
  english(<NetworkHistory target={target} />); expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "24h" })); await screen.findByText("Unable to load history");
  fireEvent.click(screen.getByRole("button", { name: /^Refresh$/ })); await screen.findByText("900.0");
  expect(fetch).toHaveBeenLastCalledWith("qa", 24, 4, expect.any(AbortSignal));
});

it("shows unavailable official context and unknown counters without inventing a healthy conclusion", async () => {
  vi.spyOn(api, "fetchMonitoringContext").mockResolvedValue({ networkCorrelation: { classification: "insufficient-evidence" }, officialStatus: { status: "unavailable" }, resource: [] });
  english(<NetworkDiagnosis targets={[target]} />);
  fireEvent.click(screen.getByText("Correlation and official incidents"));
  await waitFor(() => expect(screen.getByText("Official status unconfirmed", { exact: false })).toBeTruthy());
  expect(screen.getByText("Insufficient sample evidence", { exact: false })).toBeTruthy();
});
