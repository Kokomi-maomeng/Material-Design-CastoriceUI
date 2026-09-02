import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SettingsSwitch } from "../components/CastoriceApp";
import { useState } from "react";
import { ServiceCards } from "../components/ServiceCards";
import { Dialog } from "../components/ui/Dialog";
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

describe("v4.0 service health and dialog layers", () => {
  const service = { id: "hysteria2", name: "Hysteria2", status: "running", detail: "systemd active", version: "1.0.0", icon: "bolt" } as const;
  it("shows every service and makes warnings and storage failures red", () => {
    const { container, rerender } = renderEnglish(<ServiceCards services={[service, { ...service, id: "certificate", name: "TLS", status: "warning" }]} metrics={metrics} compact />);
    expect(container.querySelectorAll(".service-card")).toHaveLength(3);
    expect(screen.getByText("Abnormal").className).toContain("is-error");
    expect(screen.getByText("Healthy").className).toContain("is-healthy");
    expect(screen.queryByText("systemd active")).toBeNull();
    rerender(<I18nProvider><ServiceCards services={[service]} metrics={{ ...metrics, databaseWritable: false }} compact /></I18nProvider>);
    expect(screen.queryByText("Healthy")).toBeNull();
    expect(screen.getByText("Abnormal").className).toContain("is-error");
  });
  it("includes storage failure in the service-page health summary", () => {
    renderEnglish(<ServicesPage services={[service]} metrics={{ ...metrics, diskPercent: 95 }} onRefresh={vi.fn()} />);
    expect(screen.queryByText("System is healthy")).toBeNull();
    expect(screen.getByText("Some components need attention")).toBeTruthy();
  });
  it("closes only the top dialog and restores parent focus and scroll locking", () => {
    function Layers() {
      const [settings, setSettings] = useState(true);
      const [quota, setQuota] = useState(false);
      return <><Dialog open={settings} title="Settings" onClose={() => setSettings(false)}><button onClick={() => setQuota(true)}>Open quota</button></Dialog><Dialog open={quota} title="Quota" onClose={() => setQuota(false)}><input aria-label="Quota amount" /></Dialog></>;
    }
    renderEnglish(<Layers />);
    const trigger = screen.getByRole("button", { name: "Open quota" });
    trigger.focus();
    fireEvent.click(trigger);
    const parent = screen.getByRole("dialog", { name: "Settings" });
    expect(parent.inert).toBe(true);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Quota" })).toBeNull();
    expect(parent.inert).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("hidden");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.style.overflow).toBe("");
  });
});

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
    expect(screen.getByText("v4.0")).toBeTruthy();
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

  it("renders exact calendar-month bars and collapsible traffic cards", () => {
    renderEnglish(<TrafficPage traffic={{
      totalBytes: 532_000_000_000,
      protocolTotalBytes: 0,
      accountTotalBytes: 532_000_000_000,
      ranges: { "1h": [], "6h": [], "24h": [], "3day": [], "7day": [] },
      hourly: [], daily: [], protocol: [],
      monthly: [
        { startDate: "2026-04-01", endDate: "2026-04-30", bytes: 0 },
        { startDate: "2026-05-01", endDate: "2026-05-31", bytes: 200_000_000_000 },
        { startDate: "2026-06-01", endDate: "2026-06-30", bytes: 800_000_000_000 },
        { startDate: "2026-07-01", endDate: "2026-07-31", bytes: 400_000_000_000 },
        { startDate: "2026-08-01", endDate: "2026-08-31", bytes: 100_000_000_000 },
        { startDate: "2026-09-01", endDate: "2026-09-30", bytes: 50_000_000_000 },
      ],
      account: [{ name: "primary", value: 0 }, { name: "Unattributed", nameZh: "未归属", nameEn: "Unattributed", value: 532_000_000_000 }],
    }} integration={{ id: "traffic", enabled: true, configured: true, status: "ready", summary: "ready" }} onConfigure={vi.fn()} />);
    expect(Array.from(document.querySelectorAll(".ranking-row strong"), (node) => node.textContent)).toEqual(["Unattributed", "primary"]);
    expect(screen.queryByText("2 attribution entries")).toBeNull();
    expect(screen.getByText("Recent monthly traffic")).toBeTruthy();
    expect(screen.getByText("2026-04-01 – 2026-04-30")).toBeTruthy();
    expect(screen.getByText("800 GB")).toBeTruthy();
    const meters = Array.from(document.querySelectorAll<HTMLElement>(".monthly-traffic-track"));
    expect(meters).toHaveLength(6);
    expect(meters[2].firstElementChild?.getAttribute("style")).toContain("width: 100%");
    expect(document.querySelectorAll("details.traffic-disclosure[open]")).toHaveLength(2);
    fireEvent.click(screen.getByText("Managed-account usage ranking"));
    expect(document.querySelectorAll("details.traffic-disclosure[open]")).toHaveLength(1);
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
