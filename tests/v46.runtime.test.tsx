import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "../lib/api";
import { I18nProvider } from "../lib/i18n";
import { AlertsPage } from "../components/pages/AlertsPage";
import { AuditPage } from "../components/pages/AuditPage";
import { formatLocalDateTime } from "../lib/format";
import type { AlertItem, AlertPageResponse } from "../lib/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
const english = (node: React.ReactNode) => { localStorage.setItem("castorice-language", "en"); return render(<I18nProvider>{node}</I18nProvider>); };
const alert: AlertItem = { id: "same-condition", episodeId: "recovered-episode", severity: "warning", title: "Recovered pending episode", description: "Synthetic condition", source: "QA", time: "now", startedAt: "2026-01-01T00:00:00Z", resolvedAt: "2026-01-01T01:00:00Z", acknowledged: false, status: "resolved" };
const result = (items = [alert], total = items.length): AlertPageResponse => ({ items, total, page: 1, pageSize: 50, totalPages: Math.max(1, Math.ceil(total / 50)), summary: { pending: total, warning: total, critical: 0, info: 0 } });

it("keeps a recovered episode pending until manual confirmation and passes its episode identity", async () => {
  let acknowledged = false;
  const fetch = vi.spyOn(api, "fetchAlerts").mockImplementation(async () => acknowledged ? result([], 0) : result());
  const onAcknowledge = vi.fn(async () => { acknowledged = true; });
  english(<AlertsPage alerts={[]} onAcknowledge={onAcknowledge} onAcknowledgeAll={vi.fn()} onToast={vi.fn()} onConfigure={vi.fn()} />);
  expect(await screen.findByText(alert.title)).toBeTruthy();
  expect(screen.getByText("Recovered")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /^Acknowledge$/ }));
  await waitFor(() => expect(screen.queryByText(alert.title)).toBeNull());
  expect(onAcknowledge).toHaveBeenCalledWith("recovered-episode");
  expect(fetch).toHaveBeenCalledWith(expect.objectContaining({ filter: "pending" }));
});

it("loads latest 30 then expanded pages of 50 using the audit controls, including jump and collapse", async () => {
  const fetch = vi.spyOn(api, "fetchAlerts").mockImplementation(async (options) => ({ ...result(Array.from({ length: options.pageSize }, (_, index) => ({ ...alert, episodeId: `${options.page}-${index}`, title: `Episode ${options.page}-${index}` })), 231), page: options.page, pageSize: options.pageSize, totalPages: Math.ceil(231 / options.pageSize) }));
  english(<AlertsPage alerts={[]} onAcknowledge={vi.fn()} onAcknowledgeAll={vi.fn()} onToast={vi.fn()} onConfigure={vi.fn()} />);
  await screen.findByText("Episode 1-0");
  fireEvent.click(screen.getByText("All records"));
  await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ filter: "all", pageSize: 30, page: 1 })));
  await screen.findByText("Showing the latest 30 by default");
  expect(document.querySelectorAll(".alert-row")).toHaveLength(30);
  fireEvent.click(screen.getByRole("button", { name: "Show all records" }));
  await waitFor(() => expect(document.querySelectorAll(".alert-row")).toHaveLength(50));
  fireEvent.change(screen.getByRole("textbox", { name: "Enter page number" }), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: /^Go$/ }));
  await screen.findByText("Episode 5-0");
  expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ page: 5, pageSize: 50 }));
  fireEvent.click(screen.getByRole("button", { name: "Collapse to latest 30" }));
  await screen.findByText("Showing the latest 30 by default");
  expect(document.querySelectorAll(".alert-row")).toHaveLength(30);
});

it("retains pending data and reports a failed confirmation without claiming success", async () => {
  vi.spyOn(api, "fetchAlerts").mockResolvedValue(result());
  const toast = vi.fn();
  english(<AlertsPage alerts={[]} onAcknowledge={vi.fn().mockRejectedValue(new Error("Synthetic failure"))} onAcknowledgeAll={vi.fn()} onToast={toast} onConfigure={vi.fn()} />);
  await screen.findByText(alert.title);
  fireEvent.click(screen.getByRole("button", { name: /^Acknowledge$/ }));
  await waitFor(() => expect(toast).toHaveBeenCalled());
  expect(screen.getByText(alert.title)).toBeTruthy();
});

it("acknowledges all through one callback even with pending pages beyond the dashboard cache", async () => {
  vi.spyOn(api, "fetchAlerts").mockResolvedValue(result([alert], 305));
  const all = vi.fn().mockResolvedValue(undefined);
  english(<AlertsPage alerts={[]} onAcknowledge={vi.fn()} onAcknowledgeAll={all} onToast={vi.fn()} onConfigure={vi.fn()} />);
  await screen.findByText(alert.title);
  fireEvent.click(screen.getByRole("button", { name: "Acknowledge all" }));
  await waitFor(() => expect(all).toHaveBeenCalledTimes(1));
});

it("formats audit UTC timestamps in the browser time zone and tolerates invalid dates", async () => {
  const time = "2026-01-01T00:00:00+00:00";
  vi.spyOn(api, "fetchAudits").mockResolvedValue({ items: [{ id: "qa", time, action: "登录成功", category: "认证", actor: "QA", ip: "192.0.2.1", result: "成功", detail: "Synthetic" }], page: 1, pageSize: 30, totalPages: 1, total: 1 });
  english(<AuditPage />);
  const formatted = formatLocalDateTime(time, "en");
  expect(await screen.findByText(formatted)).toBeTruthy();
  expect(screen.queryByText(time)).toBeNull();
  expect(document.querySelector("time")?.getAttribute("datetime")).toBe(time);
  expect(formatLocalDateTime("invalid", "zh")).toBe("—");
});
