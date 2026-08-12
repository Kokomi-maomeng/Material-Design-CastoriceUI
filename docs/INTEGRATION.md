# CastoriceUI v2.3 backend integration guide

CastoriceUI separates browser presentation from trusted host and protocol adapters:

```text
Linux counters / Hysteria2 / sing-box / systemd / certificates
                              ↓ loopback access + server-only Secrets
                      CastoriceUI backend
                              ↓ same-origin HTTPS + session + CSRF
                           browser UI
```

The browser must never receive an upstream Secret, raw configuration, private key, stored password hash, complete subscription token, or privileged command capability.

## v2 API surface

Public, intentionally credential-free endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v2/health` | Backend health and release version |
| GET | `/api/v2/bootstrap` | Whether the first administrator is required and the configured login background |
| GET | `/api/v2/auth/background` | Validated server-hosted login image, when configured |
| POST | `/api/v2/auth/initialize` | Create the first administrator using the one-time Bootstrap Token |
| POST | `/api/v2/auth/login` | Start an application session |

Authenticated endpoints:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v2/auth/session` | Username, setup state, CSRF token, and session expiry |
| POST | `/api/v2/auth/logout` | Invalidate the current session |
| GET | `/api/v2/dashboard` | Bounded real/stale operational snapshot |
| GET | `/api/v2/audits` | Server-filtered audit records with bounded 30/50-row pagination |
| PUT | `/api/v2/settings/traffic-limit` | Update the single quota shared by Overview and Accounts |
| PUT | `/api/v2/integrations/:id` | Validate and persist an integration override |
| PUT | `/api/v2/settings/network-targets` | Replace validated name/address/order probe targets |
| PUT | `/api/v2/settings/ui` | Persist Setup visibility and optional panel visibility |
| GET | `/api/v2/settings/background-options` | List allowed server images and current background setting |
| PUT | `/api/v2/settings/login-background` | Save default, server-image, or HTTPS-URL background |
| POST | `/api/v2/initialization/complete` | Finish first-run only after required settings exist |
| POST | `/api/v2/alerts/:id/ack` | Acknowledge an alert and record the acting username |
| GET | `/api/v2/subscriptions/:id/url` | Return one complete subscription URL only after explicit action |

All authenticated mutations require both the session CSRF token and `X-CastoriceUI-Request: 1`. Session cookies are HttpOnly, SameSite=Strict, path `/`, and Secure when `secure_cookies` is enabled. Login uses a bounded failure window and serialized scrypt verification to limit CPU/memory amplification on small VPS instances.

## Hysteria2

The backend calls the authenticated Traffic Stats API on loopback. It maps `/traffic`, `/online`, and `/dump/streams` into account and activity shapes. The browser never receives the management port Secret.

Display names are not assumed to equal protocol authentication identities. For multiple accounts, configure mappings in the protected `managed_accounts` records:

```json
{
  "id": "account-1",
  "name": "Display name",
  "trafficIdentities": {
    "hysteria2": ["protocol-auth-identity"]
  }
}
```

Only the unambiguous one-account/one-identity case is automatically associated. Unknown or ambiguous identities remain unattributed rather than assigned to the wrong account. Hysteria2 activity may omit client source IP; CastoriceUI preserves that absence and never relabels the requested destination as a source.

## sing-box protocol adapters

The backend calls the protected Clash `/connections` endpoint and uses only returned connection metadata and cumulative counters. It does not consume the streaming `/traffic` endpoint as finite JSON.

AnyTLS, VLESS, SOCKS5, Shadowsocks, VMess, Trojan, and TUIC require exact inbound-tag lists. The panel never treats an unmatched connection as a generic protocol:

```json
{
  "protocol_adapters": {
    "anytls": {"inboundTags": ["anytls-in"]},
    "vless": {"inboundTags": ["vless-in", "vless-reality"], "securityProfile": "xtls-vision-reality"},
    "socks5": {"inboundTags": ["socks-in"]},
    "shadowsocks": {"inboundTags": ["ss-in"]},
    "vmess": {"inboundTags": ["vmess-in"]},
    "trojan": {"inboundTags": ["trojan-in"]},
    "tuic": {"inboundTags": ["tuic-in"]}
  }
}
```

Tags are matched case-insensitively against sing-box connection metadata. CastoriceUI does not guess a protocol from port numbers, destinations, usernames, or human-readable labels. Unknown or unconfigured tags are omitted from Active connections. Each browser setup action also performs an authenticated loopback `/connections` request before saving.

For VLESS, `securityProfile` accepts `standard`, `xtls-vision`, `reality`, or `xtls-vision-reality`. This is display/mapping metadata: XTLS Vision corresponds to the official `xtls-rprx-vision` user flow, while Reality belongs to the inbound TLS configuration. CastoriceUI does not rewrite the sing-box configuration.

## Traffic samples and account totals

The backend sampler runs independently of browser refreshes. It stores bounded adjacent interface-counter snapshots, derives non-negative deltas, and treats counter decreases as resets. The `1h`, `6h`, `24h`, `3 day`, and `7 day` views use real retained buckets with denser points than v1.5.

Host-interface traffic and protocol-account traffic are different sources:

- Overview/Traffic time series: selected host interface counter deltas;
- account usage/rankings: protocol cumulative totals after explicit identity mapping;
- account quota and Overview quota: one shared backend traffic-limit setting.

Do not claim that protocol cumulative values are billing-cycle usage unless the upstream core resets on that exact cycle.

## Connection aggregation and rates

Connection groups use protocol, account, and real source IP. The earliest active entry establishes group duration and expandable children retain the actual destinations and ports returned by adapters. When a protocol omits source IP, the value remains unavailable and must not be made copyable.

Upload/download rates are calculated only when the same connection ID appears in consecutive snapshots with non-decreasing cumulative counters. A first observation, missing ID, counter reset, or disappeared/recreated connection has no rate. The frontend hides rate columns when no group has a valid rate.

## Network probes

Operators may store up to 12 targets with unique validated names/addresses and explicit display order. Targets accept IP literals or conservative hostnames and cannot start with option characters. Probe execution uses argument arrays, not a shell. Each cached probe can contain up to eight real ICMP replies; unreachable targets return an empty history and loss state rather than an invented `0 ms` sample.

Changing the list clears the probe cache so old values are not attributed to new targets.

## Endpoint and image validation

- Hysteria2/sing-box URLs allow only `http` or `https` with `localhost` or loopback IP hosts.
- Embedded credentials, query strings, fragments, remote/private hostnames, and metadata addresses are rejected before requests.
- Strict authenticated probes use short timeouts and do not follow redirects.
- Subscription base URLs and external login backgrounds require HTTPS.
- External backgrounds are never fetched by the backend, preventing a background setting from becoming an SSRF proxy.
- Server images must remain in the configured directory, be no larger than 5 MB, and have PNG/JPEG/WebP magic bytes.

## Initialization requirements

Before Overview is reachable, first run requires:

1. a valid server-generated, one-time Bootstrap Token;
2. a unique administrator username and strong password;
3. a saved non-empty node display name;
4. a saved traffic quota of at least 1 GB;
5. explicit completion through `/api/v2/initialization/complete`.

Protocol adapters are optional and remain visibly unconfigured when skipped. Their Secrets must already exist in `/etc/castoriceui/config.json`; the browser never accepts them. This prevents a visually “successful” setup when the backend cannot authenticate the actual core.

## Legacy compatibility

v1 endpoint aliases remain for dashboard, traffic-limit, integration, subscription URL, alert acknowledgement, and health requests during a staged frontend/backend switch. New authentication, first-run, UI settings, structured network targets, and background functions are v2-only. v2 startup still removes legacy v1.2 Secrets from SQLite overrides and disables invalid non-loopback legacy endpoints.
