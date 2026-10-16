import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import * as api from "../lib/api";
import { I18nProvider } from "../lib/i18n";
import { AlertsPage } from "../components/pages/AlertsPage";
import { AuditPage } from "../components/pages/AuditPage";
import { formatLocalDateTime, localDateBoundary, normalizeTimestamp } from "../lib/format";
import type { AlertItem } from "../lib/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
const english = (node: React.ReactNode) => { localStorage.setItem("castorice-language", "en"); return render(<I18nProvider>{node}</I18nProvider>); };
const item: AlertItem = { id: "qa", episodeId: "qa", title: "Synthetic alert", description: "Synthetic", severity: "info", source: "Monitor evidence", time: "now", startedAt: "2026-10-15T00:00:00Z", acknowledged: false };
const props = () => ({ alerts: [], onAcknowledge: vi.fn(), onAcknowledgeAll: vi.fn(), onToast: vi.fn(), onConfigure: vi.fn() });
const page = (number = 1) => ({ items: Array.from({ length: 50 }, (_, i) => ({ ...item, episodeId: `${number}-${i}`, title: `Alert ${number}-${i}` })), total: 120, page: number, pageSize: 50, totalPages: 3, summary: { pending: 120, critical: 10, warning: 20, info: 90 }, logLocation: { database: "/var/lib/castoriceui/state.db", journal: "journalctl -u castoriceui-backend" } });

it("toggles 30 and 50 pending rows immediately without another request and restores the cached first page", async () => {
  const fetch = vi.spyOn(api, "fetchAlerts").mockImplementation(async (options) => page(options.page));
  english(<AlertsPage {...props()} />);
  await screen.findByText("Alert 1-0");
  expect(document.querySelectorAll(".alert-row")).toHaveLength(30);
  const initialCalls = fetch.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Show all records" }));
  expect(document.querySelectorAll(".alert-row")).toHaveLength(50);
  expect(fetch).toHaveBeenCalledTimes(initialCalls);
  fireEvent.click(screen.getByRole("button", { name: "Collapse to latest 30" }));
  expect(document.querySelectorAll(".alert-row")).toHaveLength(30);
  expect(fetch).toHaveBeenCalledTimes(initialCalls);
  fireEvent.click(screen.getByRole("button", { name: "Show all records" }));
  fireEvent.click(screen.getByRole("button", { name: "2" }));
  await screen.findByText("Alert 2-0");
  fireEvent.click(screen.getByRole("button", { name: "Collapse to latest 30" }));
  expect(screen.getByText("Alert 1-0")).toBeTruthy();
  expect(document.querySelectorAll(".alert-row")).toHaveLength(30);
  expect(screen.queryByRole("button", { name: "View evidence" })).toBeNull();
  expect(screen.queryByText("Monitor evidence")).toBeNull();
});

it("combines date, one status and one severity and synchronizes the summary buttons", async () => {
  const fetch = vi.spyOn(api, "fetchAlerts").mockResolvedValue(page());
  english(<AlertsPage {...props()} />);
  await screen.findByText("Alert 1-0");
  fireEvent.click(screen.getByRole("button", { name: "Filter" }));
  const filter = await screen.findByRole("dialog", { name: "Filter alerts" });
  fireEvent.click(within(filter).getByRole("button", { name: "From date" }));
  fireEvent.click(within(await screen.findByRole("dialog", { name: "From date" })).getByRole("button", { name: "Today" }));
  fireEvent.click(within(filter).getByRole("button", { name: "To date" }));
  fireEvent.click(within(await screen.findByRole("dialog", { name: "To date" })).getByRole("button", { name: "Today" }));
  fireEvent.click(within(filter).getByRole("button", { name: "Active" }));
  const severity = within(filter).getByRole("group", { name: "Alert severity" });
  fireEvent.click(within(severity).getByRole("button", { name: "Warning" }));
  fireEvent.click(within(severity).getByRole("button", { name: "Info" }));
  expect(within(severity).getByRole("button", { name: "Warning" }).getAttribute("aria-pressed")).toBe("false");
  fireEvent.click(within(filter).getByRole("button", { name: "Apply filters" }));
  await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ filter: "pending", status: "active", severity: "info", start: expect.stringMatching(/T/), end: expect.stringMatching(/T/), page: 1 })));
  const summary = document.querySelector(".alert-summary")! as HTMLElement;
  fireEvent.click(within(summary).getByRole("button", { name: /Warning/ }));
  await waitFor(() => expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ status: "active", severity: "warning" })));
  fireEvent.click(screen.getByRole("button", { name: "Filter · 3" }));
  const reopened = await screen.findByRole("dialog", { name: "Filter alerts" });
  expect(within(within(reopened).getByRole("group", { name: "Alert severity" })).getByRole("button", { name: "Warning" }).getAttribute("aria-pressed")).toBe("true");
});

it("uses the same local 30/50 toggle for audits", async () => {
  const fetch = vi.spyOn(api, "fetchAudits").mockResolvedValue({ ...page(), items: Array.from({ length: 50 }, (_, i) => ({ id: String(i), time: "2026-10-15T00:00:00Z", action: `Action ${i}`, category: "系统" as const, actor: "QA", ip: "192.0.2.1", result: "成功" as const, detail: "Synthetic" })) });
  english(<AuditPage />);
  await screen.findByText("Action 0");
  expect(document.querySelectorAll("tbody tr")).toHaveLength(30);
  fireEvent.click(screen.getByRole("button", { name: "Show all logs" }));
  expect(document.querySelectorAll("tbody tr")).toHaveLength(50);
  fireEvent.click(screen.getByRole("button", { name: "Collapse to latest 30" }));
  expect(document.querySelectorAll("tbody tr")).toHaveLength(30);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("normalizes epoch seconds and milliseconds, rejects uptime values and preserves local calendar boundaries", () => {
  expect(formatLocalDateTime(1792118007, "en")).toBe(formatLocalDateTime(1792118007000, "en"));
  expect(formatLocalDateTime("1792118007", "zh")).toContain("2026");
  expect(normalizeTimestamp(1900000)).toBeNull();
  expect(formatLocalDateTime("1970-01-22T00:00:00Z", "en")).toBe("—");
  expect(localDateBoundary("2026-02-30")).toBe("");
  const start = new Date(localDateBoundary("2026-10-15"));
  const end = new Date(localDateBoundary("2026-10-15", true));
  expect(start.getDate()).toBe(15); expect(start.getHours()).toBe(0);
  expect(end.getDate()).toBe(16); expect(end.getHours()).toBe(0);
});
