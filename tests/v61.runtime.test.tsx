import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "../lib/i18n";
import { AccountsPage } from "../components/pages/AccountsPage";
import { RecordHistoryControls } from "../components/ui/RecordHistory";
import { SettingsDialog } from "../components/settings/SettingsDialog";
import { emptyDashboard } from "../lib/empty-dashboard";
import { subscriptionLinks } from "../lib/subscription-links";
import { navigation } from "../lib/navigation";
import * as api from "../lib/api";
import type { Account } from "../lib/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });
const english = (node: React.ReactNode) => { localStorage.setItem("castorice-language", "en"); return render(<I18nProvider>{node}</I18nProvider>); };
const account = (id: number): Account => ({ id: `qa-${id}`, name: `QA ${id}`, email: "", status: "registered", configuredStatus: "active", expiryStatus: "notConfigured", coreEvidence: "unknown", protocols: ["AnyTLS"], usedBytes: 0, usageSource: "unmapped", quotaBytes: 0, expiresAt: "", onlineDevices: 0 });

it.each([0, 1, 29, 30, 31])("uses identical threshold controls for %i records of every kind", (total) => {
  for (const kind of ["accounts", "alerts", "audit"] as const) {
    english(<RecordHistoryControls kind={kind} expanded={false} loading={false} total={total} page={1} totalPages={1} onExpandedChange={vi.fn()} />);
    expect(screen.getByText(`${total} total records`)).toBeTruthy();
    expect(Boolean(screen.queryByText("Showing the latest 30 by default"))).toBe(total >= 30);
    expect(screen.queryAllByRole("button").length).toBe(total >= 30 ? 1 : 0);
    cleanup();
  }
});

it("paginates accounts, collapses to the first 30 and resets after filtering", () => {
  english(<AccountsPage accounts={Array.from({ length: 121 }, (_, index) => account(index))} onConfigure={vi.fn()} />);
  expect(document.querySelectorAll(".accounts-table tbody tr")).toHaveLength(30);
  fireEvent.click(screen.getByRole("button", { name: "Show all records" }));
  expect(document.querySelectorAll(".accounts-table tbody tr")).toHaveLength(50);
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByText("QA 50")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Collapse to latest 30" }));
  expect(screen.getByText("QA 0")).toBeTruthy();
  expect(document.querySelectorAll(".accounts-table tbody tr")).toHaveLength(30);
  fireEvent.change(screen.getByRole("textbox", { name: "Search accounts" }), { target: { value: "QA 120" } });
  expect(screen.getByText("1 total records")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Show all records" })).toBeNull();
});

it("fetches only the selected account subscription and aborts a late response on close", async () => {
  let complete: (value: { url: string }) => void = () => undefined;
  const fetch = vi.spyOn(api, "fetchSubscriptionUrl").mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
  english(<AccountsPage accounts={[account(1), account(2)]} subscriptions={[{ id: "first", account: "qa-1", protocols: ["AnyTLS"], enabled: true }, { id: "second", account: "QA 2", protocols: ["AnyTLS"], enabled: true }]} onConfigure={vi.fn()} />);
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "View QA 1 subscriptions" }));
  expect(fetch).toHaveBeenCalledWith("first", expect.any(AbortSignal));
  const signal = fetch.mock.calls[0][1];
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(signal?.aborted).toBe(true);
  complete({ url: "https://publisher.example.com/one.yaml" });
  fireEvent.click(screen.getByRole("button", { name: "View QA 2 subscriptions" }));
  await waitFor(() => expect(fetch).toHaveBeenLastCalledWith("second", expect.any(AbortSignal)));
  expect(screen.queryByTitle("Subscription QR code")).toBeNull();
  complete({ url: "https://publisher.example.com/two.yaml" });
  expect(await screen.findByTitle("Subscription QR code")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy Clash link" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy Shadowrocket link" })).toBeTruthy();
});

it("does not fetch disabled or unrelated subscriptions and supports retry", async () => {
  const fetch = vi.spyOn(api, "fetchSubscriptionUrl").mockRejectedValueOnce(new Error("Synthetic")).mockResolvedValue({ url: "https://publisher.example.com/a.yaml" });
  const { rerender } = english(<AccountsPage accounts={[account(1)]} subscriptions={[{ id: "disabled", account: "qa-1", protocols: [], enabled: false }]} onConfigure={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "View QA 1 subscriptions" }));
  expect(screen.getByText("This account or subscription record is disabled")).toBeTruthy();
  expect(fetch).not.toHaveBeenCalled();
  rerender(<I18nProvider><AccountsPage accounts={[account(1)]} subscriptions={[{ id: "enabled", account: "qa-1", protocols: [], enabled: true }]} onConfigure={vi.fn()} /></I18nProvider>);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await screen.findByTitle("Subscription QR code");
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("encodes the original URL and Unicode name without changing query credentials", () => {
  const url = "https://publisher.example.com/订阅.yaml?token=synthetic%2Bvalue&a=2";
  const links = subscriptionLinks(url, "示例 QA & test");
  const clash = new URL(links.clash);
  expect(clash.searchParams.get("url")).toBe(url);
  expect(clash.searchParams.get("name")).toBe("示例 QA & test");
  const encoded = links.shadowrocket.split("sub://")[1].split("?")[0];
  expect(new TextDecoder().decode(Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)))).toBe(url);
  expect(() => subscriptionLinks("javascript:alert(1)", "QA")).toThrow();
  expect(() => subscriptionLinks("https://user:secret@example.com/a", "QA")).toThrow();
});

it("groups timeout, password and all seven retention options under Security", async () => {
  vi.spyOn(api, "fetchBackgroundOptions").mockRejectedValue(new Error("Synthetic"));
  const save = vi.fn().mockResolvedValue(undefined);
  english(<SettingsDialog open onClose={vi.fn()} mode="light" color="violet" onMode={vi.fn()} onColor={vi.fn()} uiSettings={emptyDashboard.uiSettings} onUiSettings={save} nodeName="QA" trafficLimitBytes={0} onEditQuota={vi.fn()} onSaveNodeName={vi.fn()} onToast={vi.fn()} />);
  const group = screen.getByRole("heading", { name: "Security" }).closest("section");
  expect(group?.textContent).toContain("Inactivity timeout");
  expect(group?.textContent).toContain("Change password");
  const summary = Array.from(document.querySelectorAll("summary")).find((element) => element.textContent?.includes("Audit log retention"))!;
  fireEvent.click(summary);
  fireEvent.click(screen.getByRole("button", { name: "Audit log retention" }));
  expect(await screen.findAllByRole("option")).toHaveLength(7);
  fireEvent.click(screen.getByRole("option", { name: "30 days" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ auditRetentionDays: 30 }));
  expect(navigation.map((item) => item.id)).toHaveLength(9);
  expect(navigation.find((item) => item.id === "audit")?.labelEn).toBe("Audit center");
});
