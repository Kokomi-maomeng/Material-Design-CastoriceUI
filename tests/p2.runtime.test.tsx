import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../lib/i18n";
import { AuthPage } from "../components/auth/AuthPage";
import { ConnectionsPage } from "../components/pages/ConnectionsPage";
import { TrafficChart } from "../components/charts/TrafficChart";
import type { Connection, TrafficPoint } from "../lib/types";

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
});
