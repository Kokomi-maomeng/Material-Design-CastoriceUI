import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "../lib/api";
import * as clipboard from "../lib/clipboard";
import { ActiveConnections } from "../components/traffic/ActiveConnections";
import { TrafficPage } from "../components/pages/TrafficPage";
import { connectionDestination } from "../lib/connection-view";
import { emptyDashboard } from "../lib/empty-dashboard";
import { I18nProvider } from "../lib/i18n";
import type { Connection } from "../lib/types";

const connection: Connection = { id: "qa", protocol: "Trojan", account: "", sourceIp: "2001:db8::1", ipVersion: 6, connections: 1, connectedAt: null, uploadBps: 100, downloadBps: 200, details: [{ id: "flow", destination: null, connectedAt: null, uploadBps: 100, downloadBps: 200 }] };
const view = (connections = [connection]) => <I18nProvider><ActiveConnections connections={connections} now={Date.now()} onToast={vi.fn()} onConfigure={vi.fn()} /></I18nProvider>;
beforeEach(() => { localStorage.clear(); localStorage.setItem("castorice-language", "en"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("uses calendar-month usage and keeps all connection rates above the filtered list", async () => {
  const traffic = { ...emptyDashboard.traffic, totalBytes: 15e9, monthly: [{ startDate: "2026-01-01", endDate: "2026-01-31", bytes: 7e9 }] };
  const activity = { connections: [connection, { ...connection, id: "other", protocol: "VMess" as const, uploadBps: 300, downloadBps: 400 }], now: Date.now(), onConfigure: vi.fn(), onToast: vi.fn() };
  const { container } = render(<I18nProvider><TrafficPage traffic={traffic} onConfigure={vi.fn()} activity={activity} /></I18nProvider>);
  const kpis = [...container.querySelectorAll(".traffic-kpi")];
  expect(kpis.map((item) => item.querySelector("small > span")?.textContent)).toEqual(["Last 24h interface usage · RX + TX", "Measured interface usage this month", "Listed connection upload rate", "Listed connection download rate"]);
  const values = () => kpis.map((item) => item.querySelector("strong")?.textContent);
  expect(values()).toEqual(["—", "7.0 GB", "400 B/s", "600 B/s"]);
  const section = screen.getByRole("button", { name: "Live connections" });
  fireEvent.click(section);
  expect(screen.queryByRole("button", { name: "Filter" })).toBeNull();
  fireEvent.click(section);
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.click(screen.getByRole("button", { name: "Protocol" }));
  fireEvent.click(await screen.findByRole("option", { name: "Trojan" }));
  expect(container.querySelectorAll(".connection-card")).toHaveLength(1);
  expect(values()).toEqual(["—", "7.0 GB", "400 B/s", "600 B/s"]);
  expect(screen.queryByText("About these measurements")).toBeNull();
});

it("expands only the requested group, separates IPv6 ports and clears closed details", async () => {
  const other = { ...connection, id: "other", protocol: "AnyTLS" as const };
  const fetch = vi.spyOn(api, "fetchConnectionTargets").mockResolvedValue({ available: true, sampledAt: null, groups: [{ id: "qa", details: [{ id: "flow", destination: "[2001:db8::2]:443" }] }, { id: other.id, details: [{ id: "flow", destination: "other.example.test:443" }] }] });
  const copy = vi.spyOn(clipboard, "copyText").mockResolvedValue();
  const { container, unmount } = render(view([connection, other]));
  expect(fetch).not.toHaveBeenCalled();
  const toggle = screen.getByRole("button", { name: "Trojan connection details" });
  fireEvent.click(toggle);
  await screen.findByText("2001:db8::2");
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("button", { name: "AnyTLS connection details" }).getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByText("other.example.test")).toBeNull();
  expect(container.querySelector(".connection-target code")?.textContent).toBe("2001:db8::2");
  expect(container.querySelector(".connection-port")?.textContent).toBe("Port 443");
  expect(container.textContent).not.toContain("[");
  expect(container.textContent).not.toContain("]");
  fireEvent.click(screen.getByRole("button", { name: "Copy destination address 2001:db8::2" }));
  expect(copy).toHaveBeenCalledWith("2001:db8::2");
  fireEvent.click(toggle);
  await waitFor(() => expect(container.querySelector(".connection-target")).toBeNull());
  unmount();
  render(view());
  expect(screen.getByRole("button", { name: "Trojan connection details" }).getAttribute("aria-expanded")).toBe("false");
});

it("separates bracketed IPv6 endpoints without inventing a port for bare IPv6", () => {
  expect(connectionDestination("[2001:db8::443]:8443")).toEqual({ address: "2001:db8::443", port: "8443" });
  expect(connectionDestination("2001:db8::443")).toEqual({ address: "2001:db8::443", port: null });
  expect(connectionDestination("example.test:443")).toEqual({ address: "example.test", port: "443" });
});
