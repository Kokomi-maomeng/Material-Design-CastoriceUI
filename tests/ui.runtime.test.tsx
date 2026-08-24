import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SettingsSwitch } from "../components/CastoriceApp";
import { AccountsPage } from "../components/pages/AccountsPage";
import { ServicesPage } from "../components/pages/ServicesPage";
import { TrafficPage } from "../components/pages/TrafficPage";
import { FirstRunConfiguration } from "../components/setup/FirstRunConfiguration";
import { SetupWizard } from "../components/setup/SetupWizard";
import { MaterialDatePicker } from "../components/ui/MaterialDatePicker";
import { I18nProvider, withoutTerminalPeriod } from "../lib/i18n";
import { formatDecimalBytes } from "../lib/format";
import type { OverviewMetrics, ServiceStatus } from "../lib/types";

const metrics: OverviewMetrics = {
  nodeName: "Test node",
  cpuPercent: 10,
  cpuCores: 2,
  memoryPercent: 20,
  memoryUsedBytes: 2_000_000_000,
  memoryTotalBytes: 4_000_000_000,
  diskPercent: 30,
  diskUsedBytes: 3_000_000_000,
  diskTotalBytes: 10_000_000_000,
  load: [0.1, 0.2, 0.3],
  uptimeSeconds: 3600,
  trafficUsedBytes: 200_000_000_000,
  trafficLimitBytes: 1_000_000_000_000,
  trafficCycleStart: "2026-08-01T00:00:00Z",
  trafficBaselineBytes: 0,
  trafficCountMode: "sum",
  trafficQuotaUnit: "GB",
  downloadBps: 100,
  uploadBps: 50,
  interface: "eth0",
  kernel: "6.12",
  databaseBytes: 12_345,
  databaseWritable: true,
};

const renderEnglish = (view: React.ReactNode) => {
  window.localStorage.setItem("castorice-language", "en");
  return render(<I18nProvider>{view}</I18nProvider>);
};

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("v3.3 runtime behavior", () => {
  it("removes only terminal Chinese and English sentence periods", () => {
    expect(withoutTerminalPeriod("第一句。第二句。")).toBe("第一句。第二句");
    expect(withoutTerminalPeriod("First sentence. Second sentence.")).toBe("First sentence. Second sentence");
  });
  it("uses decimal provider units instead of binary GiB math", () => {
    expect(formatDecimalBytes(1_000_000_000_000)).toBe("1.0 TB");
    renderEnglish(
      <FirstRunConfiguration
        metrics={metrics}
        integrations={[]}
        onConfigure={vi.fn()}
        onSaveBasics={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    expect(screen.getByRole("spinbutton")).toHaveProperty("value", "1000");
    expect(screen.getByText("v3.3")).toBeTruthy();
  });

  it("keeps first-run completion locked until valid basics are saved", async () => {
    const onSaveBasics = vi.fn().mockResolvedValue(undefined);
    const onComplete = vi.fn().mockResolvedValue(undefined);
    renderEnglish(
      <FirstRunConfiguration
        metrics={{ ...metrics, nodeName: "VPS node" }}
        integrations={[]}
        onConfigure={vi.fn()}
        onSaveBasics={onSaveBasics}
        onComplete={onComplete}
      />,
    );
    const finish = screen.getByRole("button", { name: "Finish and open dashboard" });
    expect((finish as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: "Node display name" }), { target: { value: "Tokyo edge" } });
    fireEvent.click(screen.getByRole("button", { name: "Save basics" }));
    await waitFor(() => expect(onSaveBasics).toHaveBeenCalledWith("Tokyo edge", "1000"));
    await waitFor(() => expect((finish as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(finish);
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce());
  });

  it("presents account status without the removed note column", () => {
    renderEnglish(<AccountsPage accounts={[]} onConfigure={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Account status" })).toBeTruthy();
    expect(screen.queryByText("Note")).toBeNull();
    expect(screen.queryByText("A note is configured (content hidden)")).toBeNull();
    expect(screen.queryByText("Account management")).toBeNull();
  });

  it("exposes a visible and operable settings switch", () => {
    const onChange = vi.fn();
    renderEnglish(<SettingsSwitch checked label="Show Setup page" onChange={onChange} />);
    const control = screen.getByRole("switch", { name: "Show Setup page" });
    expect(control.getAttribute("aria-checked")).toBe("true");
    expect(control.className).toContain("is-on");
    fireEvent.click(control);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("opens a year layer before selecting a month and day", () => {
    const onChange = vi.fn();
    renderEnglish(<MaterialDatePicker value="2026-08-22" onChange={onChange} ariaLabel="Reset anchor date" />);
    fireEvent.click(screen.getByRole("button", { name: "Reset anchor date" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose year and month" }));
    expect(screen.getAllByRole("option")).toHaveLength(20);
    fireEvent.click(screen.getByRole("option", { name: "2025" }));
    expect(screen.getByRole("button", { name: "Aug" })).toBeTruthy();
  });

  it("derives database and adapter health from runtime data", () => {
    const services: ServiceStatus[] = [{
      id: "hysteria2",
      name: "Hysteria2",
      status: "running",
      detail: "healthy",
      version: "3.2.0",
      uptimeSeconds: 60,
      icon: "bolt",
    }];
    renderEnglish(
      <ServicesPage
        services={services}
        metrics={metrics}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText(/Sample write succeeded/)).toBeTruthy();
    expect(screen.getByText("1 of 1 data sources online")).toBeTruthy();
  });

  it("sorts unattributed traffic ahead of a zero-usage managed account", () => {
    renderEnglish(<TrafficPage traffic={{
      totalBytes: 532_000_000_000,
      ranges: { "1h": [], "6h": [], "24h": [], "3day": [], "7day": [] },
      hourly: [], daily: [], protocol: [],
      account: [{ name: "primary", value: 0 }, { name: "Unattributed", nameZh: "未归属", nameEn: "Unattributed", value: 532_000_000_000 }],
    }} integration={{ id: "traffic", enabled: true, configured: true, status: "ready", summary: "ready" }} onConfigure={vi.fn()} />);
    expect(Array.from(document.querySelectorAll(".ranking-row strong"), (node) => node.textContent)).toEqual(["Unattributed", "primary"]);
    expect(screen.getByText("2 attribution entries")).toBeTruthy();
    expect(screen.queryByText("Trend samples")).toBeNull();
  });

  it("keeps the setup wizard on parameters when live validation fails", async () => {
    const onSave = vi.fn().mockRejectedValue(new Error("probe failed"));
    renderEnglish(<SetupWizard selected="subscriptions" drafts={{ subscriptions: { baseUrl: "https://example.test/subscription" } }} onDraft={vi.fn()} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and validate" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("failed the server-side live probe"));
    expect(screen.queryByText("Configuration saved and live-verified")).toBeNull();
  });
});
