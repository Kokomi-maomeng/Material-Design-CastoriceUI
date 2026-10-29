# Monitoring operations

The anonymous health endpoint covers panel liveness. Authenticated `/api/v2/monitoring` separates collection freshness, service evidence and resource pressure. A healthy panel alone says nothing conclusive about an external user's proxy path.

## Sampling and state

Host samples run every 60s; core statistics and service evaluation every 5s; network every 20s; subscriptions every 60s. Each task has one independent fixed-deadline worker. Runtime/adapter/network freshness remains 90s, host 150s, subscriptions 180s. The startup budget is 30s and never restarts after a failed round. A separate 5s watchdog detects stale data even if a sampler stalls.

The root probe records boot ID/PID/start ticks, sampling start/end, configuration digest and owned listeners. It checks the generation twice. A lifecycle hook applies on the next natural core start; installing it does not restart a proxy. The 10s timer provides fallback. Only the fixed read-only helper runs as root; the panel receives no sudo rights.

Inactive/failed cores and proven missing listeners produce immediate critical service events. Missing/stale/mismatched inventory stays visibly unknown. After a 5-minute notification observation window it generates an informational reminder, never a new outage claim. Statistics failures and configuration errors remain visible. Shared root events retain affected protocols; independent errors do not disappear into them.

## Network evidence

Each target can override `latencyMs` and `lossPercent`, and optionally configure `tcpPort`, `dnsPort` and `dnsName`. Only configure a port the target actually serves. DNS checks require a numeric resolver IP and validate response ID, response flags, question count and successful answers. The default DNS query name is `example.com`. Changing thresholds resets the quality window under the new policy; events retain the policy that generated them.

The 120s window sums transmitted/received counts, with at least 24 valid packets. Two abnormal samples out of the last three confirm sustained degradation. Two complete normal samples recover it. Complete ICMP loss is visible immediately; configured TCP/DNS failure permits fast confirmation. Incomplete rounds retain observed data but never supply invented packet counts or healthy recovery. ICMP failure alone is not a proxy-business outage claim.

The dashboard includes one hour of real timestamped per-target history. The standalone current-round graph shows replies only. Gaps and incomplete samples break the time-history line. Probes follow the user's configured targets; no fixed provider incident feed or automatic route-context collection runs. Existing private historical records remain subject to normal retention.

## Evidence and capacity

SQLite stores successful, unsuccessful and incomplete monitoring samples for up to 7 days or 180,000 rows. A separate 32 MiB payload budget is applied at startup and checked every 100 sample writes; the possible inter-check excess is at most 100 bounded payloads, plus small incident transitions. The first limit reached prunes the oldest samples. Payloads are limited to 32 KiB and diagnostic queries to 1,000 rows. Capacity pruning reuses SQLite pages; a failed evidence write is logged by category without stopping a proxy. Alert history retains its existing manual-acknowledgement semantics; first/last/worst evidence is stored separately for each episode. Operational history includes no authentication values, subscription contents or connection destination lists. Database files and raw exports are private.

Resource diagnostics retain memory.high deltas, OOM counts, PSI, memory and task/FD counts, plus selected numeric TCP counters. Host CPU and interface history use the existing host samples. Whole kernel counter dumps are not duplicated into each diagnostic record. Pressure starts a 60s burst at 10s intervals. These counters require time correlation and cannot prove a particular client's outage. Keep resource limits until measured sustained pressure and host headroom justify changes.


## Certificate delivery

`deploy/receive-certificate.py` is a separate, restricted root operation. Configure root-owned `/etc/castoriceui/certificate-receiver.json` with `hostname`, `certificatePath`, `keyPath`, optional `tlsAddress`/`tlsPort`/`caFile`, `hy2Binary`, protected `hy2Client`, `singboxBinary`, protected `anytlsClient` (a native outbound), `testUrl` and `backupDirectory`. The HY2 client supports the site's existing obfuscation and requires a pinned leaf fingerprint plus successful forwarding. The isolated AnyTLS client separately verifies authentication and forwarding. Never publish that configuration. Keep stable parent directories and ownership; each file is renamed on its own filesystem. The pair is a recoverable transaction, not a single atomic rename.

Input is a bounded tar containing only `fullchain.pem` and `privkey.pem`. `check` validates SAN, seven-day validity and matching public keys. `install` also backs up both existing files, replaces them, retries endpoint activation with limits, and restores old files on failure. Identical input still verifies live activation. Normal operation and rollback never restart HY2/sing-box. Nginx receives a separate validated graceful reload when changed. Maintenance has an ID, start/end and a 60s expiry; it does not suppress confirmed service failure.

Before production use, verify certificate-only changes, key rotation, delay between files, bad SAN/key/permissions, duplicates, repeated updates and rollback against the actual core binaries. Measure existing long-lived and new AnyTLS/TLS and HY2/QUIC business connections independently. A matching disk file or unchanged PID is insufficient.

## Conditional high availability decision

First use verified hot loading for ordinary renewal. A second instance/node is justified when a real requirement exceeds that capability or process upgrades require planned draining. TCP needs new-flow allocation with old sockets drained on the original instance. UDP/QUIC also needs connection-ID/state-aware allocation; simple NAT swaps or same-port processes cannot migrate established sessions. Capacity, authentication consistency, failure detection and rollback must be designed and tested separately. The current monitoring release installs neither another node nor a same-port instance. Client fallback improves reconnect experience but cannot preserve an old session by itself.

## On-demand evidence views

Authenticated `GET /api/v2/alerts/{episodeId}/evidence` returns immutable first/worst/latest episode samples. Legacy records without samples return `available: false`. Viewing never acknowledges an alert.

Authenticated `GET /api/v2/network/{targetId}/history?hours=24&ipVersion=4` supports 1/6/24 hours and families 0/4/6 for a current target. It reads at most 5,000 source rows; 6h and 24h views use 2min and 5min bucket maxima with partial/missing markers. Capacity limits can shorten retention. Unknown targets and invalid ranges are rejected. The UI loads longer history on selection and refresh, without multiplying probe work. Expand correlation diagnostics for official component/time context and resource counters; retrieval failure remains unknown.

## Alerts and local logs (v5.2)

The alert center shows Pending and All records. Its filter combines inclusive browser-local start dates, one status (any / active / recovered pending), and one severity. The end date includes the whole selected day using the next local midnight, including daylight-saving changes. Summary buttons apply the same severity filter. Both lists and the audit log fetch 50 records and display 30 until expanded; toggling the first page uses the same in-memory snapshot. Paging retains the previous rows while loading. Height and page transitions respect reduced-motion preferences.

Critical is reserved for confirmed service/listener outages, expired certificates and exhausted traffic quota. The quota threshold is informational below 90%, warning at 90% and critical at 100%. Confirmed network degradation is warning at 20% loss or latency at least twice the target threshold and at least 300ms; lighter confirmed fluctuations become informational only after a further 3-minute observation. Existing 120s packet confirmation and two-good-round recovery remain unchanged. ICMP-only failure is never presented as a confirmed proxy outage. Configured thresholds still determine which quality observations are abnormal.

Collector/integration/probe gaps use a 5-minute observation before an informational reminder; short gaps remain in logs without creating notices. Duplicate host-collector/integration failures are grouped. Legacy network records without structured measurements are informational, with their original raw payloads retained locally. Explicit local outages remain critical while recovery checks are unavailable. The watchdog preserves observation windows and cannot silently resolve a known fault.

Unacknowledged informational recurrences within 30 minutes reuse the same episode; warning recurrences within 5 minutes do likewise. The record keeps its original start, a repeat counter and the latest restart time. A recurrence after acknowledgement, a critical recurrence, or a severity escalation after acknowledgement always creates a new episode. No historic acknowledgement is changed. Historical display wording and severity use the current classification; original stored payloads remain available for local diagnosis.

There is no alert-evidence viewer or monitoring-evidence badge. Each alert has concise record details showing its source, occurrence count and latest repeated occurrence. Database paths, internal table/episode identifiers and journal commands stay out of the UI and alert API. The database is the shared log; no file is created per alert or ping. First/worst/latest incident snapshots survive raw-sample rotation. Stable protocol inventories coalesce to one stored sample per minute; generation or listener changes record immediately. Collector errors use the existing rate-limited structured journal, without credentials or raw exceptions. Automatic archives require batches of at least 100 recovered, acknowledged episodes; smaller eligible sets stay online until a batch exists. Manual protected maintenance can export a smaller batch.

The sample byte budget limits logical payload storage, not total filesystem bytes: SQLite reuses freed pages, and protected incident rows and offline archives have separate capacity requirements. Keep the existing storage-capacity alert and move verified private archives off-volume when necessary. Never delete active or unacknowledged incidents to meet a limit.

## Upgrade from external observer monitoring

Version 5.5 removes the external observer reporter and ingestion endpoint. Upgrade accepts retired configuration keys only to discard them, removes those keys transactionally from the protected configuration and deletes only external-observer history, evidence, samples, incident state and replay tokens. Local core/listener probes and network measurements remain active. Restoring a historical alert archive skips retired observer records. Protected deployment backups retain the original data for rollback. Disable and remove any separately scheduled external reporter. Do not clear a shared system journal, as that would destroy unrelated operational history.
