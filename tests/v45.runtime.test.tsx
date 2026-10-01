import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MaterialSelect } from "../components/ui/MaterialSelect";
import { DataBoundary } from "../components/ui/DataBoundary";
import { NetworkPage } from "../components/pages/NetworkPage";
import { OverviewPage } from "../components/pages/OverviewPage";
import { I18nProvider } from "../lib/i18n";
import { emptyDashboard } from "../lib/empty-dashboard";
import { validDashboard } from "../lib/dashboard-validation";
import { fetchDashboard } from "../lib/api";
import type { NetworkTarget } from "../lib/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const english = (content: React.ReactNode) => { window.localStorage.setItem("castorice-language", "en"); return render(<I18nProvider>{content}</I18nProvider>); };

it("rejects incomplete and malformed dashboard contracts", () => {
  const value = { ...structuredClone(emptyDashboard), mode: "live" };
  expect(validDashboard(value)).toBe(true);
  for (const field of ["overview", "traffic", "resourceHistory", "uiSettings", "integrations", "connections"]) {
    const malformed = { ...value, [field]: null };
    expect(validDashboard(malformed)).toBe(false);
  }
  expect(validDashboard({ ...value, accounts: [null] })).toBe(false);
  expect(validDashboard({ ...value, overview: { ...value.overview, load: [] } })).toBe(false);
});

it("keeps the timeout and caller cancellation active while reading the body", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_path: string, options: RequestInit) => Promise.resolve({ ok: true, status: 200, json: () => new Promise((_resolve, reject) => options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true })) })));
  const result = fetchDashboard();
  const assertion = expect(result).rejects.toMatchObject({ code: "request_timeout" });
  await vi.advanceTimersByTimeAsync(10_001);
  await assertion;
  const controller = new AbortController();
  const cancelled = fetchDashboard(controller.signal);
  await Promise.resolve();
  const aborted = expect(cancelled).rejects.toMatchObject({ code: "request_aborted" });
  controller.abort();
  await aborted;
});

it("navigates listbox options with arrows, Home, End, Enter and search", async () => {
  const changed = vi.fn();
  english(<MaterialSelect value="one" ariaLabel="Choose" searchable options={[{ value: "one", label: "One" }, { value: "two", label: "Two" }, { value: "three", label: "Three" }]} onChange={changed} />);
  fireEvent.keyDown(screen.getByRole("button", { name: "Choose" }), { key: "ArrowDown" });
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Search options" })).toBe(document.activeElement));
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("option", { name: "One" }));
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(document.activeElement).toBe(screen.getByRole("option", { name: "Three" }));
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(document.activeElement).toBe(screen.getByRole("option", { name: "One" }));
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("option", { name: "Two" }));
  fireEvent.click(document.activeElement!);
  expect(changed).toHaveBeenCalledWith("two");
});

it.each([0, 1, 3, 4])("never grades %i of 4 measured targets as complete excellent coverage", (measured) => {
  const targets: NetworkTarget[] = Array.from({ length: 4 }, (_, index) => ({ id: `target-${index}`, name: `Target ${index}`, address: "192.0.2.1", provider: "Synthetic", ipVersion: 4, latency: index < measured ? 10 : null, jitter: index < measured ? 0 : null, loss: index < measured ? 0 : null, status: index < measured ? "healthy" : "unavailable", history: [] }));
  english(<NetworkPage targets={targets} onToast={vi.fn()} onConfigure={vi.fn()} onSaved={async () => {}} />);
  expect(screen.queryAllByText("Excellent").length > 0).toBe(measured === 4);
  cleanup();
  english(<OverviewPage mode="live" metrics={emptyDashboard.overview} traffic={emptyDashboard.traffic} networkTargets={targets} services={[]} connections={[]} onEditQuota={vi.fn()} onRefresh={vi.fn()} onNavigate={vi.fn()} />);
  expect(screen.queryAllByText("Excellent").length > 0).toBe(measured === 4);
});

it("contains a render failure and recovers after a new payload", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const Fault = ({ bad }: { bad: boolean }) => { if (bad) throw new Error("synthetic"); return <p>Recovered page</p>; };
  const view = (bad: boolean, resetKey: string) => <DataBoundary resetKey={resetKey} message="Data fault" retry="Retry" onRetry={vi.fn()}><Fault bad={bad} /></DataBoundary>;
  const { rerender } = english(view(true, "one"));
  expect(screen.getByRole("alert").textContent).toContain("Data fault");
  rerender(<I18nProvider>{view(false, "two")}</I18nProvider>);
  expect(screen.getByText("Recovered page")).toBeTruthy();
});
