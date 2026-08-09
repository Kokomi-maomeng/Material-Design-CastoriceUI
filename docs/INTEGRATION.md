# Backend integration guide

CastoriceUI deliberately separates presentation from protocol and infrastructure control. The canonical browser-safe models live in `lib/types.ts`; the provider contract lives in `lib/data-provider.ts`.

## Recommended flow

```text
Hysteria2 / sing-box / systemd / provider API
                    ↓ loopback or private network
            trusted backend adapters
                    ↓ authorization + redaction
              CastoriceUI JSON API
                    ↓ HTTPS / WebSocket
                  browser
```

The browser must never receive an upstream API secret, raw configuration file, private key, full stored password, or privileged command capability.

## Suggested endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/v1/overview` | Quota, system resources and forecast |
| GET/POST | `/api/v1/accounts` | List and create accounts |
| PATCH | `/api/v1/accounts/:id` | Status, quota, expiry and note |
| POST | `/api/v1/accounts/:id/reset-password` | Rotate credential; return once |
| GET | `/api/v1/connections` | Initial live-connection snapshot |
| WS | `/api/v1/realtime` | Sanitized rates and connection changes |
| GET | `/api/v1/traffic?range=day` | Aggregated traffic history |
| GET/POST | `/api/v1/subscriptions` | Subscription metadata and creation |
| POST | `/api/v1/subscriptions/:id/rotate` | Rotate bearer Token |
| GET | `/api/v1/network-targets` | IPv4/IPv6 quality snapshots |
| GET | `/api/v1/services` | Sanitized service health |
| GET/PATCH | `/api/v1/alerts` | Alerts and acknowledgement |
| GET | `/api/v1/audit` | Append-only audit events |

## Adapter guidance

### Hysteria2

Query the Traffic Stats API from the backend only. Authenticate it, bind it to loopback, and map `/traffic`, `/online`, and `/dump/streams` responses into the shared account and connection shapes. The frontend should not know the API secret or management port.

### sing-box / AnyTLS

Keep the Clash API on loopback with a strong secret. A backend adapter can sample sanitized connection metadata and rates. Never proxy the entire management API or its authorization header to the browser.

### Other protocols

Normalize protocol names into the `Protocol` field. Extend the union or move to server-defined strings when plugin discovery is introduced; do not duplicate the page for every protocol.

## Authentication and mutation safety

- Use secure, HTTP-only session cookies and server-side authorization.
- Require CSRF protection for state-changing requests.
- Rate-limit login, password reset, Token rotation, and service actions.
- Re-authenticate or require TOTP for destructive changes.
- Write the audit event on the server in the same transaction as the mutation.
- Use idempotency keys for retries where duplicate actions are dangerous.

## Streaming and performance

Send an initial snapshot, then compact upsert/remove events. A one-second UI update is enough for operator visibility; avoid repainting large tables on every network packet. Aggregate traffic history server-side and return bounded time series.
