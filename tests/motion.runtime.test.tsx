import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AnimatedDetails } from "../components/ui/AnimatedDetails";
import { Collapse } from "../components/ui/Collapse";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("retains a draft while collapsed and removes it from interaction immediately", () => {
  const view = render(<Collapse expanded><input aria-label="Draft" defaultValue="kept" /></Collapse>);
  const input = screen.getByRole("textbox", { name: "Draft" });
  fireEvent.change(input, { target: { value: "edited" } });
  view.rerender(<Collapse expanded={false}><input aria-label="Draft" defaultValue="kept" /></Collapse>);
  expect(screen.queryByRole("textbox", { name: "Draft" })).toBeNull();
  expect(input.closest("[inert]")).not.toBeNull();
  view.rerender(<Collapse expanded><input aria-label="Draft" defaultValue="kept" /></Collapse>);
  expect(screen.getByRole("textbox", { name: "Draft" })).toBe(input);
  expect(input).toHaveProperty("value", "edited");
});

function disclosure() {
  const animations: { cancel: ReturnType<typeof vi.fn>; onfinish: (() => void) | null }[] = [];
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return { height: (this as HTMLDetailsElement).open ? 200 : 40 } as DOMRect;
  });
  const animate = vi.fn(() => { const item = { cancel: vi.fn(), onfinish: null as (() => void) | null }; animations.push(item); return item as unknown as Animation; });
  Object.defineProperty(HTMLElement.prototype, "animate", { value: animate, configurable: true });
  render(<AnimatedDetails><summary>Options</summary><div><input aria-label="Setting" defaultValue="retained" /></div></AnimatedDetails>);
  const summary = screen.getByText("Options");
  const details = summary.parentElement as HTMLDetailsElement;
  return { summary, details, animations, animate };
}

it("reverses a disclosure without an obsolete finish hiding the reopened content", () => {
  const { summary, details, animations, animate } = disclosure();
  fireEvent.click(summary);
  expect(details.open).toBe(true);
  animations[0].onfinish?.();
  screen.getByRole("textbox").focus();
  fireEvent.click(summary);
  const obsolete = animations[1].onfinish;
  expect(details.open).toBe(true);
  expect(document.activeElement).toBe(summary);
  expect(details.querySelector("div")?.inert).toBe(true);
  fireEvent.click(summary);
  expect(animations[1].cancel).toHaveBeenCalled();
  expect(animations[1].onfinish).toBeNull();
  expect(obsolete).toBeTypeOf("function");
  expect(animate).toHaveBeenCalledTimes(2); // At full height, reversal can settle immediately.
  expect(details.open).toBe(true);
  expect(details.querySelector("div")?.inert).toBe(false);
  fireEvent.click(summary); animations.at(-1)?.onfinish?.();
  expect(details.open).toBe(false);
});

it("uses native open/close immediately under reduced motion", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const { summary, details, animate } = disclosure();
  fireEvent.click(summary); expect(details.open).toBe(true);
  fireEvent.click(summary); expect(details.open).toBe(false);
  expect(animate).not.toHaveBeenCalled();
});

it("cancels pending animations on unmount", () => {
  const { summary, animations } = disclosure();
  fireEvent.click(summary); cleanup();
  expect(animations[0].onfinish).toBeNull();
  expect(animations[0].cancel).toHaveBeenCalled();
});
