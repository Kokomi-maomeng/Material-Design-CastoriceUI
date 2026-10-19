import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as api from "../lib/api";
import * as backgrounds from "../components/auth/useLoginBackground";
import { CastoriceApp } from "../components/CastoriceApp";
import { SettingsDialog } from "../components/settings/SettingsDialog";
import { PresetSlider } from "../components/ui/PresetSlider";
import { I18nProvider } from "../lib/i18n";
import { emptyDashboard } from "../lib/empty-dashboard";
import type { LoginBackgroundSettings, LoginAppearance } from "../lib/types";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); });
const appearance: LoginAppearance = { type: "url", url: "/api/v2/auth/background", fit: "cover", glass: "default", glassEnabled: false, cacheSeconds: 0, revision: "synthetic-v54" };
const configured: LoginBackgroundSettings = { ...appearance, value: "https://images.example.com/api/random" };
function settings(onAppearance = vi.fn()) {
  localStorage.setItem("castorice-language", "en");
  return render(<I18nProvider><SettingsDialog open onClose={vi.fn()} mode="system" color="violet" onMode={vi.fn()} onColor={vi.fn()} uiSettings={emptyDashboard.uiSettings} onUiSettings={vi.fn()} nodeName="QA node" trafficLimitBytes={1_000_000_000} onEditQuota={vi.fn()} onSaveNodeName={vi.fn()} onToast={vi.fn()} onAppearance={onAppearance} /></I18nProvider>);
}

it("keeps API and server drafts independently through unsaved source switches, and synchronizes a successful save", async () => {
  vi.spyOn(api, "fetchBackgroundOptions").mockResolvedValue({ files: ["a.png", "b.png"], directory: "/example/images", selected: appearance, configured });
  const updated = { ...appearance, glassEnabled: true };
  const save = vi.spyOn(api, "updateLoginBackground").mockResolvedValue(updated);
  const apply = vi.fn(); settings(apply);
  fireEvent.click(screen.getByText("Sign-in background"));
  const url = await screen.findByDisplayValue(configured.value);
  fireEvent.change(url, { target: { value: "https://images.example.com/draft" } });
  fireEvent.click(screen.getByRole("switch", { name: "Liquid Glass" }));
  const choose = async (name: string) => {
    fireEvent.click(screen.getByRole("button", { name: "Sign-in background source" }));
    fireEvent.click(await screen.findByRole("option", { name }));
  };
  await choose("Server image");
  fireEvent.click(screen.getByRole("button", { name: "Allowed image" }));
  fireEvent.click(await screen.findByRole("option", { name: "b.png" }));
  await choose("Default Material background"); await choose("Image API");
  expect(screen.getByDisplayValue("https://images.example.com/draft")).toBe(url);
  expect(screen.getByRole("switch", { name: "Liquid Glass" }).getAttribute("aria-checked")).toBe("true");
  expect(screen.getByRole("slider")).toHaveProperty("value", "1");
  await choose("Server image");
  expect(screen.getByRole("button", { name: "Allowed image" }).textContent).toContain("b.png");
  await choose("Image API");
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Save sign-in background" }));
  await waitFor(() => expect(apply).toHaveBeenLastCalledWith(updated));
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ value: "https://images.example.com/draft", glass: "default", glassEnabled: true }));
});

it("does not apply an obsolete background-options response after the dialog closes", async () => {
  let complete!: (value: Awaited<ReturnType<typeof api.fetchBackgroundOptions>>) => void;
  vi.spyOn(api, "fetchBackgroundOptions").mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  const apply = vi.fn(); const view = settings(apply);
  view.unmount();
  complete({ files: [], directory: "/example/images", selected: appearance, configured });
  await Promise.resolve(); expect(apply).not.toHaveBeenCalled();
});

it("drags continuously, snaps on release, and uses full presets for keyboard input", () => {
  const changes = vi.fn();
  function Fixture() {
    const [value, setValue] = useState(1);
    return <PresetSlider value={value} labels={["Clear", "Default", "Tinted"]} ariaLabel="Glass" onChange={(next) => { changes(next); setValue(next); }} />;
  }
  render(<Fixture />); const slider = screen.getByRole("slider");
  fireEvent.pointerDown(slider); fireEvent.input(slider, { target: { value: ".68" } });
  expect(slider).toHaveProperty("value", "0.68");
  expect(slider.getAttribute("aria-valuetext")).toBe("Default");
  fireEvent.pointerUp(slider); expect(slider).toHaveProperty("value", "1");
  fireEvent.keyDown(slider, { key: "ArrowRight" }); expect(slider).toHaveProperty("value", "2");
  fireEvent.keyDown(slider, { key: "Home" }); expect(slider).toHaveProperty("value", "0");
  fireEvent.keyDown(slider, { key: "ArrowRight" }); expect(slider).toHaveProperty("value", "1");
  fireEvent.pointerDown(slider); fireEvent.pointerCancel(slider);
  fireEvent.input(slider, { target: { value: "1.72" } }); expect(slider).toHaveProperty("value", "1.72");
  fireEvent.change(slider); expect(slider).toHaveProperty("value", "2");
  expect(changes.mock.calls.every(([value]) => Number.isInteger(value))).toBe(true);
});

it("starts image preparation before a slow session check without flashing the login page", async () => {
  localStorage.setItem("castorice-language", "en");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.spyOn(api, "fetchBootstrap").mockResolvedValue({ setupRequired: false, bootstrapAvailable: false, appearance });
  let finish!: (value: Awaited<ReturnType<typeof api.fetchSession>>) => void;
  vi.spyOn(api, "fetchSession").mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const hook = vi.spyOn(backgrounds, "useLoginBackground").mockReturnValue("");
  render(<I18nProvider><CastoriceApp /></I18nProvider>);
  await waitFor(() => expect(hook).toHaveBeenCalledWith(appearance, expect.any(Number)));
  expect(screen.queryByRole("heading", { name: "Welcome back" })).toBeNull();
  vi.spyOn(api, "fetchDashboard").mockResolvedValue({ ...emptyDashboard, mode: "live" });
  await act(async () => finish({ username: "qa-admin", csrfToken: "synthetic", expiresAt: Math.floor(Date.now() / 1000) + 3600, setupComplete: true }));
  await waitFor(() => expect(document.querySelector(".app-shell")).not.toBeNull());
});
