import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NetworkProbeDialog } from "../components/network/NetworkProbeDialog";
import { NetworkChart } from "../components/charts/NetworkChart";
import { I18nProvider } from "../lib/i18n";
import * as api from "../lib/api";
import { draftTarget, emptyTarget, NETWORK_LIMITS, probeAddress, targetPayload, validateTargets } from "../lib/network-editor";
import type { NetworkTarget } from "../lib/types";

const node = (i: number): NetworkTarget => ({ id: `qa-${i}`, name: `Node ${i}`, provider: "Test", address: `192.0.2.${i}`, ipVersion: 4, order: i, latency: 1.3, loss: 0, jitter: 0, history: [], status: "healthy" });
beforeEach(() => localStorage.setItem("castorice-language", "en"));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear(); });

it("validates canonical IP/IDNA hosts, independent optional ports and DNS combinations", () => {
  expect(probeAddress("2001:0db8:0:0::1")?.address).toBe("2001:db8::1");
  expect(probeAddress("EXAMPLE.com.")?.address).toBe("example.com");
  expect(probeAddress("例子.测试")?.address).toMatch(/^xn--/);
  for (const address of ["999.1.2.3", "192.168.01.1", "https://example.com", "example.com:443", "bad..test", "a b.test", "example.com/path", "[::1]"]) expect(probeAddress(address)).toBeUndefined();
  const draft = draftTarget(node(1));
  expect(validateTargets([draft])).toEqual([{}]);
  for (const port of ["0", "65536", "-1", "1.2", "1e3", "oops"]) expect(validateTargets([{ ...draft, tcpPort: port }])[0].tcpPort).toBeTruthy();
  expect(validateTargets([{ ...draft, dnsName: "example.com" }])).toEqual([{}]);
  expect(validateTargets([{ ...draft, dnsPort: "53" }])).toEqual([{}]);
  expect(validateTargets([{ ...draft, address: "example.com", dnsName: "example.com" }])[0].address).toBeTruthy();
  expect(validateTargets([{ ...draft, dnsName: "bad.-name.test" }])[0].dnsName).toBeTruthy();
  expect(validateTargets([{ ...draft, ipVersion: 6 }])[0].ipVersion).toBeTruthy();
  expect(validateTargets([emptyTarget()])[0]).toHaveProperty("name");
});

it("reserves explicit positions, assigns automatic positions and reports every duplicate", () => {
  const drafts = [draftTarget(node(1)), draftTarget(node(2)), { ...draftTarget(node(3)), order: "" }];
  drafts[0].order = "2"; drafts[1].order = "1";
  expect(targetPayload(drafts).map((item) => item.name)).toEqual(["Node 2", "Node 1", "Node 3"]);
  drafts[1].order = "2";
  expect(validateTargets(drafts).slice(0, 2).every((error) => error.order?.[1].includes("targets 1, 2"))).toBe(true);
  drafts[1].address = "192.0.2.1";
  expect(validateTargets(drafts)[1].address).toBeTruthy();
});

it("blocks duplicate selection and invalid input, then saves in order and reopens sorted", async () => {
  const save = vi.spyOn(api, "updateNetworkTargets").mockResolvedValue({ targets: [] });
  const onClose = vi.fn();
  const props = { onClose, onSaved: async () => {}, onToast: vi.fn() };
  const view = render(<I18nProvider><NetworkProbeDialog open targets={[node(1), node(2)]} {...props} /></I18nProvider>);
  const orders = screen.getAllByRole("button", { name: "Order" });
  fireEvent.click(orders[1]); fireEvent.click(await screen.findByRole("option", { name: "1" }));
  expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getAllByText(/Order 1 is duplicated/)).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(orders[0]); fireEvent.click(await screen.findByRole("option", { name: "2" }));
  fireEvent.change(screen.getAllByLabelText("TCP port")[0], { target: { value: "65536" } });
  expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getAllByLabelText("TCP port")[0], { target: { value: "" } });
  expect([...document.querySelectorAll('.network-editor-row .network-field-error')].map((element) => element.textContent)).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(save.mock.calls[0][0].map((item) => item.name)).toEqual(["Node 2", "Node 1"]);
  expect(onClose).toHaveBeenCalledOnce();
  view.rerender(<I18nProvider><NetworkProbeDialog open={false} targets={[node(1), node(2)]} {...props} /></I18nProvider>);
  view.rerender(<I18nProvider><NetworkProbeDialog open targets={[{ ...node(1), order: 2 }, { ...node(2), order: 1 }]} {...props} /></I18nProvider>);
  await waitFor(() => expect((screen.getAllByLabelText("Name")[0] as HTMLInputElement).value).toBe("Node 2"));
});

it("caps adding targets at the shared policy limit", () => {
  render(<I18nProvider><NetworkProbeDialog open targets={Array.from({ length: NETWORK_LIMITS.maxTargets }, (_, i) => node(i + 1))} onClose={vi.fn()} onSaved={async () => {}} onToast={vi.fn()} /></I18nProvider>);
  expect(screen.getByRole("button", { name: /Add target/ }).hasAttribute("disabled")).toBe(true);
});

it("retains a real curve after clock skew or a long fetch pause, and connects equal partial buckets", () => {
  vi.useFakeTimers();
  const at = Date.now() / 1000 - 3600;
  const samples = [0, 1, 2].map((i) => ({ capturedAt: at + i, latency: 1.3, loss: 0, complete: true, hasGaps: true, status: "healthy" }));
  const { container } = render(<I18nProvider><NetworkChart label="Retained" seconds samples={samples} /></I18nProvider>);
  const chart = screen.getByRole("img", { name: "Retained" });
  expect(chart.querySelectorAll('path[data-metric="latency"]')).toHaveLength(1);
  const d = chart.querySelector('path[data-metric="latency"]')!.getAttribute("d");
  expect(d).toContain("C ");
  act(() => vi.advanceTimersByTime(120000));
  expect(chart.querySelector('path[data-metric="latency"]')!.getAttribute("d")).toBe(d);
  expect(within(container).getByText(/Updates paused/)).toBeTruthy();
});

it("connects measured partial history buckets while leaving wholly missing intervals open", () => {
  const samples = [0, 1, 2, 4, 5].map((i) => ({ capturedAt: i * 60, latency: 1.3 + i / 10, loss: 0, complete: i !== 4, hasGaps: true, status: "healthy" }));
  render(<I18nProvider><NetworkChart label="Partial history" samples={samples} step={60} /></I18nProvider>);
  const chart = screen.getByRole("img", { name: "Partial history" });
  expect(chart.querySelectorAll('path[data-metric="latency"]')).toHaveLength(1);
  expect(chart.querySelectorAll('circle[data-metric="latency"]')).toHaveLength(1);
  expect(chart.querySelectorAll('[data-gap="true"]')).toHaveLength(5);
});
