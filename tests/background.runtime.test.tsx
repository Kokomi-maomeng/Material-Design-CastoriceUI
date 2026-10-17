import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useLoginBackground } from "../components/auth/useLoginBackground";
import type { LoginAppearance } from "../lib/types";

let revision = 0;
let entry: { blob: () => Promise<Blob>; headers: Headers } | undefined;
let objectCount = 0;
const fetchImage = vi.fn();
const cachePut = vi.fn();
const blob = () => new Blob(["synthetic"], { type: "image/png" });
const response = (age = 0, stale = false) => ({ ok: true, headers: new Headers({ "X-Background-Age": String(age), "X-Background-Stale": stale ? "1" : "0" }), blob: async () => blob() });
const appearance = (cacheSeconds: LoginAppearance["cacheSeconds"] = 0): LoginAppearance => ({ type: "url", url: "/api/v2/auth/background", fit: "cover", cacheSeconds, revision: `background-regression-${++revision}` });
const tick = (ms = 1) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  vi.useFakeTimers(); entry = undefined;
  const OriginalURL = URL;
  class TestURL extends OriginalURL {
    static createObjectURL = vi.fn(() => `blob:synthetic-${++objectCount}`);
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("URL", TestURL);
  vi.stubGlobal("Image", class { src = ""; decode() { return Promise.resolve(); } });
  vi.stubGlobal("fetch", fetchImage);
  cachePut.mockReset();
  vi.stubGlobal("caches", { open: async () => ({ match: async () => entry, put: cachePut, keys: async () => [], delete: vi.fn() }), keys: async () => [], delete: vi.fn() });
  fetchImage.mockReset(); fetchImage.mockResolvedValue(response());
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("does not paint the old no-cache image while waiting, then paints one decoded replacement", async () => {
  const config = appearance(0);
  entry = { blob: async () => blob(), headers: new Headers({ "X-Background-Saved-At": String(Date.now()) }) };
  let finish!: (result: ReturnType<typeof response>) => void;
  fetchImage.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const { result } = renderHook(() => useLoginBackground(config));
  await tick(); expect(result.current).toBe(""); expect(fetchImage).toHaveBeenCalledTimes(1);
  await act(async () => { finish(response()); });
  expect(result.current).toMatch(/^blob:/);
  const shown = result.current;
  await tick(65_000); expect(result.current).toBe(shown); expect(fetchImage).toHaveBeenCalledTimes(1);
});

it("uses a valid two-second entry without requesting, and waits for new bytes after expiry", async () => {
  const config = appearance(2);
  entry = { blob: async () => blob(), headers: new Headers({ "X-Background-Saved-At": String(Date.now() - 500) }) };
  const first = renderHook(() => useLoginBackground(config));
  await tick(); expect(first.result.current).toMatch(/^blob:/); expect(fetchImage).not.toHaveBeenCalled();
  first.unmount(); await tick(2000);
  let finish!: (result: ReturnType<typeof response>) => void;
  fetchImage.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const second = renderHook(() => useLoginBackground(config));
  await tick(); expect(second.result.current).toBe("");
  await act(async () => { finish(response()); });
  expect(second.result.current).toMatch(/^blob:/); expect(fetchImage).toHaveBeenCalledTimes(1);
});

it("does not renew a server fallback's TTL or replace it later in the same visit", async () => {
  const config = appearance(2);
  fetchImage.mockResolvedValue(response(30, true));
  const first = renderHook(() => useLoginBackground(config));
  await tick(); const shown = first.result.current; expect(shown).toMatch(/^blob:/);
  await tick(60_000); expect(first.result.current).toBe(shown); expect(fetchImage).toHaveBeenCalledTimes(1);
  first.unmount(); fetchImage.mockResolvedValue(response());
  renderHook(() => useLoginBackground(config)); await tick(); expect(fetchImage).toHaveBeenCalledTimes(2);
});

it("falls back only after failure and does not start a later refresh behind that image", async () => {
  const config = appearance();
  entry = { blob: async () => blob(), headers: new Headers() };
  fetchImage.mockRejectedValue(new Error("synthetic-offline"));
  const { result } = renderHook(() => useLoginBackground(config));
  await tick(); expect(result.current).toMatch(/^blob:/);
  await tick(60_000); expect(fetchImage).toHaveBeenCalledTimes(1);
});

it("retries a cold failure within a finite budget and aborts an obsolete request", async () => {
  const config = appearance(); fetchImage.mockRejectedValue(new Error("synthetic-offline"));
  const cold = renderHook(() => useLoginBackground(config));
  await tick(60_000); expect(cold.result.current).toBe(""); expect(fetchImage).toHaveBeenCalledTimes(3);
  cold.unmount(); fetchImage.mockReset(); fetchImage.mockReturnValue(new Promise(() => {}));
  const pendingConfig = appearance();
  const pending = renderHook(() => useLoginBackground(pendingConfig)); await tick();
  const signal = fetchImage.mock.calls[0][1].signal;
  expect(signal.aborted).toBe(false); pending.unmount(); expect(signal.aborted).toBe(true);
});

it("starts the client TTL after decoding finishes, without subtracting transfer time", async () => {
  let decoded!: () => void;
  vi.stubGlobal("Image", class { src = ""; decode() { return new Promise<void>((resolve) => { decoded = resolve; }); } });
  fetchImage.mockResolvedValue(response(1));
  const config = appearance(2);
  const { result } = renderHook(() => useLoginBackground(config));
  await tick(5000); expect(result.current).toBe("");
  const completedAt = Date.now();
  await act(async () => { decoded(); });
  expect(result.current).toMatch(/^blob:/);
  expect(cachePut.mock.calls[0][1].headers.get("X-Background-Saved-At")).toBe(String(completedAt));
});

it("keeps the document image when the viewport class changes after expiry", async () => {
  vi.stubGlobal("innerWidth", 1920); vi.stubGlobal("innerHeight", 1080);
  const config = appearance(2);
  const { result } = renderHook(() => useLoginBackground(config));
  await tick(); const shown = result.current;
  vi.stubGlobal("innerWidth", 390); vi.stubGlobal("innerHeight", 844);
  act(() => window.dispatchEvent(new Event("resize")));
  await tick(5000);
  expect(result.current).toBe(shown); expect(fetchImage).toHaveBeenCalledTimes(1);
});
