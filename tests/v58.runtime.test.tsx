import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "../lib/api";
import * as clipboard from "../lib/clipboard";
import { ConnectionsPage } from "../components/pages/ConnectionsPage";
import { connectionDestination } from "../lib/connection-view";
import { I18nProvider } from "../lib/i18n";
import type { Connection } from "../lib/types";

const connection: Connection = { id: "qa", protocol: "Trojan", account: "", sourceIp: "2001:db8::1", ipVersion: 6, connections: 1, connectedAt: null, uploadBps: 100, downloadBps: 200, details: [{ id: "flow", destination: null, connectedAt: null, uploadBps: 100, downloadBps: 200 }] };
const view = (connections = [connection]) => <I18nProvider><ConnectionsPage connections={connections} now={Date.now()} onToast={vi.fn()} onConfigure={vi.fn()} /></I18nProvider>;
beforeEach(() => { localStorage.clear(); localStorage.setItem("castorice-language", "en"); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("keeps totals for all connections while filtering and places controls with upload first in the card", async () => {
  const { container } = render(view([connection, { ...connection, id: "other", protocol: "VMess", uploadBps: 300, downloadBps: 400 }]));
  const totals = container.querySelector(".connection-speeds")?.textContent;
  expect(totals?.indexOf("Total connection upload")).toBeLessThan(totals?.indexOf("Total connection download") ?? 0);
  expect(container.querySelector(".connection-summary")?.contains(screen.getByRole("switch", { name: "Show live connections", checked: false }))).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  fireEvent.click(screen.getByRole("button", { name: "Protocol" }));
  fireEvent.click(await screen.findByRole("option", { name: "Trojan" }));
  expect(container.querySelectorAll(".connection-card")).toHaveLength(1);
  expect(container.querySelector(".connection-speeds")?.textContent).toBe(totals);
  expect(screen.queryByText("About these measurements")).toBeNull();
});

it("shows IPv6 targets immediately with separate ports, copies the address, and clears targets on switch off", async () => {
  const fetch = vi.spyOn(api, "fetchConnectionTargets").mockResolvedValue({ available: true, sampledAt: null, groups: [{ id: "qa", details: [{ id: "flow", destination: "[2001:db8::2]:443" }] }] });
  const copy = vi.spyOn(clipboard, "copyText").mockResolvedValue();
  const { container, unmount } = render(view());
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("switch", { name: "Show live connections", checked: false }));
  await waitFor(() => expect(container.querySelector("details")?.open).toBe(true));
  expect(screen.getByRole("switch", { name: "Show live connections", checked: true })).toBeTruthy();
  expect(container.querySelector(".connection-target code")?.textContent).toBe("2001:db8::2");
  expect(container.querySelector(".connection-port")?.textContent).toBe("Port 443");
  expect(container.textContent).not.toContain("[");
  expect(container.textContent).not.toContain("]");
  fireEvent.click(screen.getByRole("button", { name: "Copy destination address 2001:db8::2" }));
  expect(copy).toHaveBeenCalledWith("2001:db8::2");
  fireEvent.click(screen.getByRole("switch", { name: "Show live connections", checked: true }));
  expect(container.querySelector(".connection-target")).toBeNull();
  unmount();
  render(view());
  expect(screen.getByRole("switch", { name: "Show live connections", checked: false })).toBeTruthy();
});

it("separates bracketed IPv6 endpoints without inventing a port for bare IPv6", () => {
  expect(connectionDestination("[2001:db8::443]:8443")).toEqual({ address: "2001:db8::443", port: "8443" });
  expect(connectionDestination("2001:db8::443")).toEqual({ address: "2001:db8::443", port: null });
  expect(connectionDestination("example.test:443")).toEqual({ address: "example.test", port: "443" });
});
