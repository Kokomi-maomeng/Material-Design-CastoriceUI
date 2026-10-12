import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "../lib/api";
import { SettingsDialog } from "../components/settings/SettingsDialog";
import { I18nProvider } from "../lib/i18n";
import { emptyDashboard } from "../lib/empty-dashboard";
import { backgroundProfile, BACKGROUND_TIMES, pendingCriticalAlerts } from "../lib/login-background";
import { formatBytes, formatDecimalBytes, formatDuration, formatTimeSpan } from "../lib/format";

afterEach(() => { cleanup(); vi.restoreAllMocks(); localStorage.clear(); });

it("uses the full pending critical summary even when the dashboard page has no critical rows", () => {
  expect(pendingCriticalAlerts({ critical: 2 }, [])).toBe(2);
  expect(pendingCriticalAlerts({ critical: 0 }, [{ severity: "critical", acknowledged: false }])).toBe(0);
  expect(pendingCriticalAlerts(undefined, [{ severity: "critical", acknowledged: false }, { severity: "critical", acknowledged: true }, { severity: "warning", acknowledged: false }])).toBe(1);
});

it("bounds viewport classes while distinguishing phone, 1080p, 2k and zoomed layouts", () => {
  expect(backgroundProfile(390, 844)).toBe("portrait-640");
  expect(backgroundProfile(1920, 1080)).toBe("landscape-1920");
  expect(backgroundProfile(2560, 1440)).toBe("landscape-2560");
  expect(backgroundProfile(1280, 720)).toBe("landscape-1280");
  const profiles = new Set(Array.from({ length: 10000 }, (_, i) => backgroundProfile(i + 1, i % 3 ? 844 : 30000)));
  expect(profiles.size).toBeLessThanOrEqual(8);
});

it("formats duration and byte units identically across languages without changing scales", () => {
  document.documentElement.lang = "zh";
  expect(formatDuration(90061)).toBe("1d 01:01:01");
  expect(formatBytes(1024 ** 3)).toBe("1.0 GiB");
  expect(formatDecimalBytes(1_000_000_000)).toBe("1.0 GB");
  expect([2, 30, 60, 120, 3600, 86400].map(formatTimeSpan)).toEqual(["2s", "30s", "1min", "2min", "1h", "1d"]);
});

it("saves all glass and duration controls together, defaults to middle, disables and restores the preset slider", async () => {
  localStorage.setItem("castorice-language", "en");
  vi.spyOn(api, "fetchBackgroundOptions").mockResolvedValue({ files: [], directory: "/var/lib/castoriceui/login-backgrounds", selected: { type: "url", url: "/api/v2/auth/background", fit: "cover" }, configured: { type: "url", value: "https://images.example.com/random", fit: "contain" } });
  const save = vi.spyOn(api, "updateLoginBackground").mockResolvedValue({ type: "url", url: "/api/v2/auth/background", fit: "contain" });
  render(<I18nProvider><SettingsDialog open onClose={vi.fn()} mode="light" color="violet" onMode={vi.fn()} onColor={vi.fn()} uiSettings={emptyDashboard.uiSettings} onUiSettings={vi.fn()} nodeName="QA node" trafficLimitBytes={1_000_000_000} onEditQuota={vi.fn()} onSaveNodeName={vi.fn()} onToast={vi.fn()} /></I18nProvider>);
  fireEvent.click(screen.getByText("Sign-in background"));
  await waitFor(() => expect(screen.getByDisplayValue("https://images.example.com/random")).toBeTruthy());
  expect(screen.queryByText("Image position")).toBeNull();
  fireEvent.click(screen.getByText("Liquid Glass"));
  const slider = screen.getByRole("slider", { name: "Glass transparency" });
  expect(slider).toHaveProperty("value", "1");
  fireEvent.change(slider, { target: { value: "2" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "Use card appearance" }));
  expect(slider).toHaveProperty("disabled", true);
  expect(slider).toHaveProperty("value", "2");
  fireEvent.click(screen.getByRole("checkbox", { name: "Use card appearance" }));
  expect(slider).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByRole("button", { name: "Background duration" }));
  expect(await screen.findAllByRole("option")).toHaveLength(BACKGROUND_TIMES.length);
  fireEvent.click(screen.getByRole("option", { name: /^1min$/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save sign-in background" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ type: "url", value: "https://images.example.com/random", fit: "contain", cacheSeconds: 60, glass: "tinted", glassEnabled: true }));
});
