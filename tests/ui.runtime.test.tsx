import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SettingsSwitch } from "../components/CastoriceApp";
import { AccountsPage } from "../components/pages/AccountsPage";
import { ServicesPage } from "../components/pages/ServicesPage";
import { FirstRunConfiguration } from "../components/setup/FirstRunConfiguration";
import { I18nProvider } from "../lib/i18n";
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

describe("v3.0 runtime behavior", () => {
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
    expect(screen.getByText("v3.0")).toBeTruthy();
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

  it("derives database and adapter health from runtime data", () => {
    const services: ServiceStatus[] = [{
      id: "hysteria2",
      name: "Hysteria2",
      status: "running",
      detail: "healthy",
      version: "3.0.0",
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
});
