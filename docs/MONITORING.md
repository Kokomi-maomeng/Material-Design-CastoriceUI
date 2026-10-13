# Monitoring operations

The anonymous health endpoint covers panel liveness. Authenticated `/api/v2/monitoring` separates collection freshness, service evidence, outbound network correlation, external business samples and resource pressure. A healthy panel alone says nothing conclusive about an external user's proxy path.

## Sampling and state

Host samples run every 60s; core statistics and service evaluation every 5s; network every 20s; subscriptions every 60s; auxiliary context every 600s. Each task has one independent fixed-deadline worker. Runtime/adapter/network freshness remains 90s, host 150s, subscriptions 180s. The startup budget is 30s and never restarts after a failed round. A separate 5s watchdog detects stale data even if a sampler stalls.

The root probe records boot ID/PID/start ticks, sampling start/end, configuration digest and owned listeners. It checks the generation twice. A lifecycle hook applies on the next natural core start; installing it does not restart a proxy. The 10s timer provides fallback. Only the fixed read-only helper runs as root; the panel receives no sudo rights.

Inactive/failed cores and proven missing listeners produce immediate critical service events. Missing/stale/mismatched inventory stays visibly unknown, then generates a warning after a bounded 30s evidence budget. Statistics failures and configuration errors remain visible. Shared root events retain affected protocols; independent errors do not disappear into them.

## Network evidence

Each target can override `latencyMs` and `lossPercent`, and optionally configure `tcpPort`, `dnsPort` and `dnsName`. Only configure a port the target actually serves. DNS checks require a numeric resolver IP and validate response ID, response flags, question count and successful answers. The default DNS query name is `example.com`. Changing thresholds resets the quality window under the new policy; events retain the policy that generated them.

The 120s window sums transmitted/received counts, with at least 24 valid packets. Two abnormal samples out of the last three confirm sustained degradation. Two complete normal samples recover it. Complete ICMP loss is visible immediately; configured TCP/DNS failure permits fast confirmation. Incomplete rounds retain observed data but never supply invented packet counts or healthy recovery. ICMP failure alone is not a proxy-business outage claim.

The public dashboard includes one hour of real timestamped per-target history. The standalone current-round graph shows replies only. Gaps and incomplete samples break the time-history line. Correlation says which targets/families changed together; official incident overlap is only supporting context, and unavailable official status is not evidence of no incident. Bounded route captures describe the current route and are authenticated private operational data.

## Evidence and capacity

SQLite stores successful, unsuccessful and incomplete monitoring samples for up to 7 days or 180,000 rows, whichever limit is reached first. Payloads are limited to 32 KiB and diagnostic queries to 1,000 rows. Capacity pruning reuses SQLite pages; a failed evidence write is logged by category without stopping a proxy. Alert history retains its existing manual-acknowledgement semantics; first/last/worst evidence is stored separately for each episode. Operational history includes no authentication values, subscription contents or connection destination lists. Database files and raw exports are private.

Resource evidence includes memory.high deltas, OOM counts, PSI, memory, task/FD counts, CPU and host TCP/interface counters. Pressure starts a 60s burst at 10s intervals. These counters require time correlation and cannot prove a particular client's outage. Keep resource limits until measured sustained pressure and host headroom justify changes.

## External business monitoring

Configure a protected `external_probe_secret` of at least 32 characters and a bounded `external_probe_agents` list. External reports POST to `/api/v2/monitoring/probe` with `X-Castorice-Signature`, the HMAC-SHA256 of ASCII JSON sorted by key with compact separators. Accepted fields are `agentId`, a fresh random `nonce`, Unix `observedAt` within 60s, boolean `agentHealthy`, and `protocols` containing `anytls`/`hysteria2` results. Each result has status `passed`, `failed` or `unavailable`, and may include `failedStage`, `durationMs`, `certificateSha256` and `existingConnection`. Nonces persist across backend restarts. Unknown fields, private URLs and credentials are rejected.

Use a dedicated low-privilege test identity when the core's authentication mechanism supports adding it safely. A node must test its own connectivity and report observer failure separately. Run isolated clients with loopback-only listeners, disabled TUN/system-proxy mutation, small requests and strict deadlines. Credentials belong only in root/private agent configuration. One vantage point cannot represent every user network. Unconfigured or stale external evidence is not healthy evidence.

`deploy/external-probe.py --config <private-file>` runs one bounded check using an existing trusted Mihomo binary. Its configuration contains `panelUrl`, `secret`, `agentId`, `clientBinary`, an HTTPS `testUrl` and `proxies` keyed by `anytls`/`hysteria2` with native client proxy settings. Keep certificate verification enabled. Schedule once per minute with overlap disabled and a bounded execution time. Small HEAD requests test both an established tunnel and a new tunnel. AnyTLS also verifies the ingress TLS certificate separately. Client errors produce categories only; raw logs stay in a restricted temporary directory. Report signatures grant permission only to submit evidence, never to administer the panel. Rotating the secret or removing the agent disables submissions. Check the observer's own HTTPS path first; when it fails, neither proxy is declared offline. Two failed reports confirm a business warning and two successful reports recover it; reports older than 180s become observer evidence warnings.

On a Windows observer already using a TUN client, optionally set `interfaceName`, numeric `interfaceIndex` and numeric IPv4 `resolverAddress` from the active physical adapter. The isolated client binds that adapter; observer HTTPS/TLS and explicit DNS bind only their own sockets with Winsock `IP_UNICAST_IF`. This avoids circular dependence on the monitored tunnel and system fake-IP DNS. It changes no global route, DNS setting or existing client. A changed/offline adapter produces observer evidence failure; refresh its private configuration after a network change. See [Microsoft's socket option contract](https://learn.microsoft.com/en-us/windows/win32/winsock/ipproto-ip-socket-options).

Optionally configure `observerUrls` with one or two independent HTTPS targets for observer health. They run concurrently and at least one must succeed before proxy business checks run. Both failing produces unavailable observer evidence. Without this setting, `testUrl` is the health target. Use targets on separate providers and keep them independent of the monitored server; a target failure alone must not prevent otherwise valid proxy tests. The separate `testUrl` still determines the actual forwarded business request.

Report freshness uses the server's receipt time together with the signed observation time. Up to 60 seconds of future clock skew matches submission validation; neither a receipt nor an observation older than 180 seconds stays fresh. A small positive observer clock offset must not create a transient unavailable alert or prevent the two-report business confirmation/recovery policy.

Adding a dedicated server identity is conditional on the existing authentication mode. A single shared-password core cannot gain a separate identity through this monitoring API. Keep an existing protected identity until an independently planned safe authentication migration is possible; never restart a live proxy merely to claim dedicated-identity acceptance. This limitation must be included in site acceptance evidence.

## Certificate delivery

`deploy/receive-certificate.py` is a separate, restricted root operation. Configure root-owned `/etc/castoriceui/certificate-receiver.json` with `hostname`, `certificatePath`, `keyPath`, optional `tlsAddress`/`tlsPort`/`caFile`, `hy2Binary`, protected `hy2Client`, `singboxBinary`, protected `anytlsClient` (a native outbound), `testUrl` and `backupDirectory`. The HY2 client supports the site's existing obfuscation and requires a pinned leaf fingerprint plus successful forwarding. The isolated AnyTLS client separately verifies authentication and forwarding. Never publish that configuration. Keep stable parent directories and ownership; each file is renamed on its own filesystem. The pair is a recoverable transaction, not a single atomic rename.

Input is a bounded tar containing only `fullchain.pem` and `privkey.pem`. `check` validates SAN, seven-day validity and matching public keys. `install` also backs up both existing files, replaces them, retries endpoint activation with limits, and restores old files on failure. Identical input still verifies live activation. Normal operation and rollback never restart HY2/sing-box. Nginx receives a separate validated graceful reload when changed. Maintenance has an ID, start/end and a 60s expiry; it does not suppress confirmed service failure.

Before production use, verify certificate-only changes, key rotation, delay between files, bad SAN/key/permissions, duplicates, repeated updates and rollback against the actual core binaries. Measure existing long-lived and new AnyTLS/TLS and HY2/QUIC business connections independently. A matching disk file or unchanged PID is insufficient.

## Conditional high availability decision

First use verified hot loading for ordinary renewal. A second instance/node is justified when a real requirement exceeds that capability or process upgrades require planned draining. TCP needs new-flow allocation with old sockets drained on the original instance. UDP/QUIC also needs connection-ID/state-aware allocation; simple NAT swaps or same-port processes cannot migrate established sessions. Capacity, authentication consistency, failure detection and rollback must be designed and tested separately. The current monitoring release installs neither another node nor a same-port instance. Client fallback improves reconnect experience but cannot preserve an old session by itself.

## On-demand evidence views

Authenticated `GET /api/v2/alerts/{episodeId}/evidence` returns immutable first/worst/latest episode samples. Legacy records without samples return `available: false`. Viewing never acknowledges an alert.

Authenticated `GET /api/v2/network/{targetId}/history?hours=24&ipVersion=4` supports 1/6/24 hours and families 0/4/6 for a current target. It reads at most 5,000 source rows; 6h and 24h views use 2min and 5min bucket maxima with partial/missing markers. Capacity limits can shorten retention. Unknown targets and invalid ranges are rejected. The UI loads longer history on selection and refresh, without multiplying probe work. Expand correlation diagnostics for official component/time context and resource counters; retrieval failure remains unknown.
