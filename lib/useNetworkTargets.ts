import { useEffect, useState } from "react";
import { fetchNetworkTargets } from "./api";
import type { NetworkTarget } from "./types";

export function useNetworkTargets(initial: NetworkTarget[]) {
  const signature = JSON.stringify(initial.map(({ id, name, address, order, ipVersion, tcpPort, dnsPort, dnsName }) => ({ id, name, address, order, ipVersion, tcpPort, dnsPort, dnsName })));
  const [live, setLive] = useState<{ signature: string; targets: NetworkTarget[] }>();
  useEffect(() => {
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending || controller.signal.aborted || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const targets = await fetchNetworkTargets(controller.signal);
        if (!controller.signal.aborted) setLive({ signature, targets });
      } catch { /* Keep the last observed sample and its original timestamp. */ }
      finally { pending = false; }
    };
    void load();
    const resume = () => { if (document.visibilityState !== "hidden") void load(); };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    const timer = window.setInterval(() => void load(), 1000);
    return () => { controller.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", resume); window.removeEventListener("online", resume); };
  }, [signature]);
  if (live?.signature !== signature) return initial;
  return initial.map((target) => {
    const current = live.targets.find((item) => item.id === target.id && item.address === target.address);
    if (!current || Date.parse(target.observedAt ?? "") > Date.parse(current.observedAt ?? "")) return target;
    return { ...current, name: target.name, order: target.order };
  });
}
