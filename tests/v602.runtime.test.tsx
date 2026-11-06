import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useGlassLight } from "../components/auth/useGlassLight";
import { AuthPage } from "../components/auth/AuthPage";
import { I18nProvider } from "../lib/i18n";
import * as backgrounds from "../components/auth/useLoginBackground";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function lighting({ hover = true, reduced = false } = {}) {
  const queries: { matches: boolean; change?: () => void }[] = [];
  vi.stubGlobal("matchMedia", (query: string) => {
    const media = { matches: query.includes("any-hover") ? hover : reduced, change: undefined as (() => void) | undefined };
    queries.push(media);
    return { get matches() { return media.matches; }, addEventListener: (_: string, f: () => void) => { media.change = f; }, removeEventListener: vi.fn() };
  });
  let now = 0, sequence = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => { const id = ++sequence; frames.set(id, f); return id; });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  function Card({ enabled }: { enabled: boolean }) { return <section ref={useGlassLight(enabled)} data-testid="glass" />; }
  const view = render(<Card enabled />);
  const card = view.getByTestId("glass");
  vi.spyOn(card, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
  const pointer = (type: string, x = 90, y = 80, pointerType = "mouse") => {
    const event = new Event(type);
    Object.assign(event, { clientX: x, clientY: y, pointerType, buttons: 0 });
    fireEvent(card, event);
  };
  const step = (count = 1) => {
    for (let i = 0; i < count; i++) { now += 16; const batch = [...frames.values()]; frames.clear(); act(() => batch.forEach(f => f(now))); }
  };
  const x = () => parseFloat(card.style.getPropertyValue("--glass-light-x")) || 18;
  return { view, card, pointer, step, x, frames, queries, disable: () => view.rerender(<Card enabled={false} />) };
}

it("eases toward a re-entering pointer from the current light position", () => {
  const m = lighting();
  m.pointer("pointerenter"); expect(m.x()).toBe(18);
  m.step(); expect(m.x()).toBeGreaterThan(18); expect(m.x()).toBeLessThan(90);
  m.step(70); expect(m.x()).toBe(90); expect(m.frames.size).toBe(0);
  m.pointer("pointerleave"); m.step(3); const leaving = m.x();
  expect(leaving).toBeGreaterThan(18); expect(leaving).toBeLessThan(90);
  m.pointer("pointerenter", 5, 10); expect(m.x()).toBe(leaving);
  m.step(); expect(m.x()).toBeLessThan(leaving); expect(m.x()).toBeGreaterThan(5);
  m.step(70); expect(m.x()).toBe(5); expect(m.frames.size).toBe(0);
});

it("returns to a resting light after cancellation or window blur and stops scheduling", () => {
  const m = lighting();
  for (const action of [() => m.pointer("pointercancel"), () => fireEvent(window, new Event("blur"))]) {
    m.pointer("pointermove"); m.step(70); expect(m.x()).toBe(90);
    action(); m.step(70); expect(m.x()).toBe(18); expect(m.frames.size).toBe(0);
  }
});

it("keeps touch, unknown pointers and reduced-motion lighting still", () => {
  for (const [settings, type] of [[{ reduced: true }, "mouse"], [{}, "touch"], [{}, ""], [{}, "unknown"]] as const) {
    const m = lighting(settings);
    m.pointer("pointerenter", 90, 80, type);
    m.step(70); expect(m.x()).toBe(18); expect(m.frames.size).toBe(0); m.view.unmount();
  }
});

it("follows actual mouse input when device-wide hover metadata is unavailable", () => {
  const m = lighting({ hover: false });
  m.pointer("pointerenter"); m.step(); expect(m.x()).toBeGreaterThan(18); expect(m.x()).toBeLessThan(90);
  m.pointer("pointermove", 70, 60, "touch"); m.step(70); expect(m.x()).toBe(18); expect(m.frames.size).toBe(0);
});

it("resets a moving light when accessibility preferences change and cleans up on disable", () => {
  const m = lighting();
  m.pointer("pointermove"); m.step(2); expect(m.frames.size).toBe(1);
  act(() => { m.queries[0].matches = true; m.queries[0].change?.(); });
  expect(m.x()).toBe(18); expect(m.frames.size).toBe(0);
  m.pointer("pointermove"); expect(m.frames.size).toBe(0);
  act(() => { m.queries[0].matches = false; m.queries[0].change?.(); });
  m.pointer("pointermove"); expect(m.frames.size).toBe(1);
  m.disable(); expect(m.frames.size).toBe(0); expect(m.card.style.getPropertyValue("--glass-light-x")).toBe("");
  m.pointer("pointermove"); expect(m.frames.size).toBe(0);
});

it("preserves a usable glass form while its image is pending and reveals the same form after decode", () => {
  vi.spyOn(backgrounds, "useLoginBackground").mockReturnValue("");
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const appearance = { type: "url" as const, url: "/api/v2/auth/background", fit: "cover" as const, glassEnabled: true, glass: "clear" as const };
  const auth = (background: string) => <I18nProvider><AuthPage background={background} bootstrap={{ setupRequired: false, bootstrapAvailable: false, appearance }} onAuthenticated={vi.fn()} /></I18nProvider>;
  const view = render(auth(""));
  const input = view.getByRole("textbox"); fireEvent.change(input, { target: { value: "draft-user" } });
  expect(view.container.querySelector(".auth-card")?.getAttribute("data-glass")).toBe("clear");
  expect(view.container.querySelector(".auth-page")?.getAttribute("data-background-state")).toBe("pending");
  view.rerender(auth("blob:decoded-synthetic"));
  expect(view.container.querySelector(".auth-page")?.getAttribute("data-background-state")).toBe("ready");
  expect(view.getByRole("textbox")).toBe(input); expect(input).toHaveProperty("value", "draft-user");
});
