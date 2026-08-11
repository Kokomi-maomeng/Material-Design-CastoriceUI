import type {
  Account,
  AlertItem,
  AuditEvent,
  Connection,
  NetworkTarget,
  ServiceStatus,
  Subscription,
  TrafficPoint,
  TrafficRange,
} from "./types";

/**
 * Backend-neutral contract for the CastoriceUI frontend.
 * Implement this interface in a host application and inject it through an API
 * route, websocket, or your preferred state layer. Never expose core secrets to
 * the browser; the server adapter must redact credentials before returning data.
 */
export interface CastoriceDataProvider {
  getAccounts(): Promise<Account[]>;
  getConnections(): Promise<Connection[]>;
  getTraffic(range: TrafficRange): Promise<TrafficPoint[]>;
  getSubscriptions(): Promise<Subscription[]>;
  getNetworkTargets(): Promise<NetworkTarget[]>;
  getServices(): Promise<ServiceStatus[]>;
  getAlerts(): Promise<AlertItem[]>;
  getAuditEvents(): Promise<AuditEvent[]>;
}

export interface RealtimeConnectionEvent {
  type: "snapshot" | "upsert" | "remove";
  connection?: Connection;
  connections?: Connection[];
  id?: string;
}

export const adapterNotes = {
  hysteria2: "Map the authenticated Traffic Stats API on the server side only.",
  singBox: "Keep the Clash API bound to loopback and proxy sanitized snapshots.",
  generic: "Add protocol adapters server-side without changing UI data shapes.",
} as const;
