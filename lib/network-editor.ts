import limits from "../server/castoriceui/network_limits.json";
import type { NetworkTarget } from "./types";

export const NETWORK_LIMITS = limits;
export interface TargetDraft {
  name: string;
  address: string;
  order: string;
  ipVersion: 0 | 4 | 6;
  tcpPort: string;
  dnsPort: string;
  dnsName: string;
}
export type TargetErrors = Partial<Record<keyof TargetDraft, [string, string]>>;
export const emptyTarget = (): TargetDraft => ({ name: "", address: "", order: "", ipVersion: 0, tcpPort: "", dnsPort: "", dnsName: "" });
export const draftTarget = (target: NetworkTarget): TargetDraft => ({
  name: target.name, address: target.address, order: String(target.order ?? ""), ipVersion: target.ipVersion,
  tcpPort: String(target.tcpPort ?? ""), dnsPort: String(target.dnsPort ?? ""), dnsName: target.dnsName ?? "",
});

/** Match the server's IP/IDNA host rules, without accepting URLs or embedded ports. */
export function probeAddress(value: string): { address: string; family: 0 | 4 | 6 } | undefined {
  const raw = value.trim().replace(/\.$/, "");
  if (!raw || raw.length > limits.maxHostLength || /[\s/@?#\\[\]]/.test(raw)) return;
  if (raw.includes(":")) {
    try {
      const address = new URL(`http://[${raw}]/`).hostname.slice(1, -1);
      return { address, family: 6 };
    } catch { return; }
  }
  if (/^[\d.]+$/.test(raw)) {
    const parts = raw.split(".");
    if (parts.length !== 4 || parts.some((part) => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return;
    return { address: raw, family: 4 };
  }
  try {
    const address = new URL(`http://${raw}/`).hostname;
    if (address.length > limits.maxHostLength || address.split(".").some((part) => !/^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(part))) return;
    return { address, family: 0 };
  } catch { return; }
}

export function validateTargets(drafts: TargetDraft[]) {
  const errors: TargetErrors[] = drafts.map(() => ({}));
  const orders = new Map<number, number[]>();
  const addresses = new Map<string, number[]>();
  drafts.forEach((item, index) => {
    const row = errors[index];
    if (!item.name.trim() || item.name.trim().length > limits.maxNameLength || [...item.name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) row.name = ["名称必填，最多 60 个字符。", "Enter a name of 1–60 characters."];
    const host = probeAddress(item.address);
    if (!host) row.address = ["请输入有效 IPv4、IPv6 或域名，不含协议、路径或端口。", "Enter an IPv4, IPv6 or host name without a scheme, path or port."];
    else {
      addresses.set(host.address, [...addresses.get(host.address) ?? [], index]);
      if (host.family && item.ipVersion && host.family !== item.ipVersion) row.ipVersion = ["协议族与 IP 地址不一致，请选择自动或对应协议族。", "Select Automatic or the family matching the IP address."];
    }
    if (item.order !== "") {
      const order = Number(item.order);
      if (!Number.isInteger(order) || order < 1 || order > limits.maxTargets) row.order = [`排序请选择 1–${limits.maxTargets} 或自动。`, `Choose an order from 1–${limits.maxTargets} or Automatic.`];
      else orders.set(order, [...orders.get(order) ?? [], index]);
    }
    for (const key of ["tcpPort", "dnsPort"] as const) {
      if (item[key] !== "" && (!/^\d+$/.test(item[key]) || Number(item[key]) < limits.minPort || Number(item[key]) > limits.maxPort)) row[key] = ["端口必须是 1–65535 的整数，留空不启用。", "Use an integer port from 1–65535, or leave blank."];
    }
    const dns = item.dnsName.trim();
    if (dns && (!probeAddress(dns) || probeAddress(dns)?.family !== 0)) row.dnsName = ["请输入有效的 DNS 验证域名。", "Enter a valid DNS check host name."];
    if ((dns || item.dnsPort) && host?.family === 0) row.address = ["DNS(UDP) 探测需填写 DNS 服务器的 IP 地址。", "DNS(UDP) requires the DNS server's numeric IP address."];
  });
  for (const [order, indices] of orders) if (indices.length > 1) for (const index of indices) errors[index].order = [`排序 ${order} 重复：第 ${indices.map((i) => i + 1).join("、")} 项。`, `Order ${order} is duplicated in targets ${indices.map((i) => i + 1).join(", ")}.`];
  for (const indices of addresses.values()) if (indices.length > 1) for (const index of indices) errors[index].address = [`探测地址重复：第 ${indices.map((i) => i + 1).join("、")} 项。`, `Duplicate address in targets ${indices.map((i) => i + 1).join(", ")}.`];
  return errors;
}

export function targetPayload(drafts: TargetDraft[]) {
  const reserved = new Set(drafts.filter((item) => item.order !== "").map((item) => Number(item.order)));
  return drafts.map((item) => {
    let order = Number(item.order);
    if (item.order === "") {
      order = 1;
      while (reserved.has(order)) order++;
      reserved.add(order);
    }
    const host = probeAddress(item.address)!;
    return { name: item.name.trim(), address: host.address, order, ipVersion: host.family || item.ipVersion,
      ...(item.tcpPort ? { tcpPort: Number(item.tcpPort) } : {}), ...(item.dnsPort ? { dnsPort: Number(item.dnsPort) } : {}),
      ...(item.dnsName.trim() ? { dnsName: probeAddress(item.dnsName)!.address } : {}) };
  }).sort((a, b) => a.order - b.order);
}
