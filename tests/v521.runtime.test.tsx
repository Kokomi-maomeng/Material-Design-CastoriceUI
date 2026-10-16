import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "../lib/api";
import { I18nProvider } from "../lib/i18n";
import { AuditPage } from "../components/pages/AuditPage";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it("shows audit filter failures, hides rows from the old filter and allows retry", async () => {
  const record = { id: "qa", time: "2026-10-15T00:00:00Z", action: "Synthetic old action", category: "系统" as const, actor: "QA", ip: "192.0.2.1", result: "成功" as const, detail: "Synthetic" };
  const fetch = vi.spyOn(api, "fetchAudits").mockResolvedValueOnce({ items: [record], total: 1, page: 1, pageSize: 50, totalPages: 1 }).mockRejectedValueOnce(new Error("Synthetic offline"));
  localStorage.setItem("castorice-language", "en");
  render(<I18nProvider><AuditPage /></I18nProvider>);
  await screen.findByText("Synthetic old action");
  fireEvent.click(screen.getByRole("button", { name: "Authentication" }));
  await screen.findByRole("alert");
  expect(screen.queryByText("Synthetic old action")).toBeNull();
  fetch.mockResolvedValueOnce({ items: [{ ...record, action: "Synthetic retry action", category: "认证" }], total: 1, page: 1, pageSize: 50, totalPages: 1 });
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(screen.getByText("Loading records")).toBeTruthy();
  await screen.findByText("Synthetic retry action");
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(fetch).toHaveBeenLastCalledWith(expect.objectContaining({ category: "认证", page: 1, pageSize: 50 }));
});
