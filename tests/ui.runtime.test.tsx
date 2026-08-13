import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
  trafficCoverageStart: "2026-08-05T00:00:00Z",
  trafficCoverageComplete: false,
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

describe("v2.5 runtime behavior", () => {
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
    expect(screen.getByText("v2.5")).toBeTruthy();
  });

  it("presents accounts as read-only status rather than management", () => {
    renderEnglish(<AccountsPage accounts={[]} onConfigure={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Account status" })).toBeTruthy();
    expect(screen.getByText("Read-only synchronization")).toBeTruthy();
    expect(screen.queryByText("Account management")).toBeNull();
  });

  it("derives database and adapter health from runtime data", () => {
    const services: ServiceStatus[] = [{
      id: "hysteria2",
      name: "Hysteria2",
      status: "running",
      detail: "healthy",
      version: "2.6.0",
      uptimeSeconds: 60,
      icon: "bolt",
    }];
    renderEnglish(
      <ServicesPage
        services={services}
        metrics={metrics}
        onRefresh={vi.fn()}
        onConfigure={vi.fn()}
      />,
    );
    expect(screen.getByText(/Sample write succeeded/)).toBeTruthy();
    expect(screen.getByText("1 of 1 data sources online")).toBeTruthy();
  });
});
