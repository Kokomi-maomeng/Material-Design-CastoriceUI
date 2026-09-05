import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SettingsSwitch } from "../components/CastoriceApp";
import { useState } from "react";
import { ServiceCards } from "../components/ServiceCards";
import { Dialog } from "../components/ui/Dialog";
import { AccountsPage } from "../components/pages/AccountsPage";
import { ServicesPage } from "../components/pages/ServicesPage";
import { TrafficPage } from "../components/pages/TrafficPage";
import { OverviewPage } from "../components/pages/OverviewPage";
import { emptyDashboard } from "../lib/empty-dashboard";
import { FirstRunConfiguration } from "../components/setup/FirstRunConfiguration";
import { SetupWizard } from "../components/setup/SetupWizard";
import { MaterialDatePicker } from "../components/ui/MaterialDatePicker";
import { TrafficQuotaDialog } from "../components/traffic/TrafficQuotaDialog";
import { I18nProvider, withoutTerminalPeriod } from "../lib/i18n";
import { formatDecimalBytes } from "../lib/format";
import { PROJECT_VERSION } from "../lib/project";
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

describe("v4.1 navigation and protocol inspection", () => {
  const overview = (onNavigate = vi.fn(), onEditQuota = vi.fn()) => <OverviewPage mode="live" metrics={metrics} connections={[]} services={[]} networkTargets={[]} traffic={emptyDashboard.traffic} onEditQuota={onEditQuota} onRefresh={vi.fn()} onNavigate={onNavigate} />;
  it("routes every overview shortcut and isolates the account destination", () => {
    const navigate = vi.fn();
    renderEnglish(overview(navigate));
    for (const [label, page] of [["View traffic analytics", "traffic"], ["View traffic trend analytics", "traffic"], ["CPU · View services", "services"], ["Memory · View services", "services"], ["Storage · View services", "services"], ["View connections", "connections"], ["View account status", "accounts"], ["View network quality", "network"], ["View services", "services"]]) {
      navigate.mockClear();
      fireEvent.click(screen.getByRole("link", { name: label }));
      expect(navigate.mock.calls).toEqual([[page]]);
    }
    expect(screen.queryByText("View all")).toBeNull();
  });
  it("preserves quota editing, range controls, chart interaction and text selection", () => {
    const navigate = vi.fn(), edit = vi.fn();
    const { container } = renderEnglish(overview(navigate, edit));
    fireEvent.click(screen.getByRole("button", { name: "Edit traffic quota" }));
    expect(edit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "6h" }));
    expect(screen.getByRole("button", { name: "6h" }).className).toContain("is-selected");
    fireEvent.click(container.querySelector('[data-no-navigate]')!);
    expect(navigate).not.toHaveBeenCalled();
    const label = screen.getByText("Traffic usage");
    const range = document.createRange();
    range.selectNodeContents(label);
    const selection = window.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    fireEvent.click(label);
    expect(navigate).not.toHaveBeenCalled();
    // A click clearing an earlier selection must also be ignored.
    fireEvent.pointerDown(label, { clientX: 0, clientY: 0 });
    selection.removeAllRanges();
    fireEvent.click(label, { detail: 1 });
    expect(navigate).not.toHaveBeenCalled();
    const link = screen.getByRole("link", { name: "View traffic analytics" });
    fireEvent.keyDown(link, { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith("traffic");
  });
  it("clears protocol hover when leaving the whole card, including after focus and click", () => {
    const traffic = { ...emptyDashboard.traffic, protocolTotalBytes: 3e9, protocol: [{ name: "AnyTLS", value: 1e9 }, { name: "Hysteria2", value: 2e9 }] };
    const { container } = renderEnglish(<TrafficPage traffic={traffic} onConfigure={vi.fn()} />);
    const circle = container.querySelector('.donut-segment')!;
    fireEvent.pointerEnter(circle); fireEvent.focus(circle); fireEvent.pointerDown(circle);
    expect(container.querySelector('.donut-center')?.textContent).toContain("1.00 GBAnyTLS");
    fireEvent.pointerLeave(container.querySelector('.protocol-panel')!);
    expect(container.querySelector('.donut-center')?.textContent).toContain("3 GBDistribution total");
    expect(container.querySelector('.donut-segment.is-active')).toBeNull();
    fireEvent.focus(screen.getByRole("button", { name: /Hysteria2/ }));
    expect(container.querySelector('.donut-center')?.textContent).toContain("Hysteria2");
    fireEvent.blur(screen.getByRole("button", { name: /Hysteria2/ }));
    expect(container.querySelector('.donut-center')?.textContent).toContain("Distribution total");
  });
  it("shows host memory and counts every protocol without counting the core twice", () => {
    const services: ServiceStatus[] = [
      { id: "singbox", kind: "core", name: "sing-box", status: "running", detail: "active", version: "1.13.19", icon: "dns" },
      { id: "anytls", kind: "protocol", name: "AnyTLS", status: "running", detail: "verified", version: "sing-box 1.13.19", icon: "encrypted" },
      { id: "socks5", kind: "protocol", name: "SOCKS5", status: "stopped", detail: "Configuration incomplete", version: "unknown", icon: "lan" },
    ];
    const { container } = renderEnglish(<ServicesPage services={services} metrics={metrics} onRefresh={vi.fn()} />);
    expect(screen.getByText("Memory usage").nextElementSibling?.textContent).toContain("20.0%");
    expect(screen.getByText("1 of 2 data sources online")).toBeTruthy();
    const socks = screen.getByText("SOCKS5").closest('.service-card')!;
    expect(socks.querySelector('.is-error')?.textContent).toBe("Abnormal");
    expect(socks.textContent).toContain("Unavailable");
    expect(container.querySelector('.service-health-card.is-warning')).toBeTruthy();
  });
});

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
    expect(screen.getByText(`v${PROJECT_VERSION}`)).toBeTruthy();
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

  it("preserves quota schedule fields after the dialog is split from the app shell", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const onClose = vi.fn();
    renderEnglish(<TrafficQuotaDialog
      trafficLimitBytes={2_000_000_000_000}
      quota={{ bytes: 2_000_000_000_000, autoReset: true, periodUnit: "week", periodCount: 2, resetAnchor: "2026-08-17", resetTime: "03:30", timezone: "UTC", cycleStart: "2026-08-31T03:30:00Z", nextReset: "2026-09-14T03:30:00Z" }}
      onClose={onClose}
      onSave={onSave}
      onToast={vi.fn()}
    />);
    const amount = screen.getByRole("spinbutton", { name: "Total traffic (GB)" });
    expect(amount).toHaveProperty("value", "2000");
    fireEvent.change(amount, { target: { value: "2500" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      bytes: 2_500_000_000_000,
      autoReset: true,
      periodUnit: "week",
      periodCount: 2,
      resetAnchor: "2026-08-17",
      resetTime: "03:30",
      timezone: "UTC",
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
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
