# CastoriceUI v2.5.0

v2.5 is a security, accounting-integrity, and release-hygiene update. It remains compatible with the protected v2.4 configuration and SQLite data after the new configuration defaults are merged.

## Security and privacy

- Dashboard accounts and subscriptions now use explicit response allowlists; unknown or nested config fields cannot enter the normal dashboard payload.
- Production config loading rejects unknown keys, public backend listeners, non-loopback management endpoints, insecure cookies, relative protected paths, and invalid ranges.
- Login failure throttling persists in SQLite across backend restarts. Request concurrency is bounded, while the Nginx example adds request/connection limits and stricter timeouts.
- Session inactivity is enforced by both browser and backend with a finite default. Cross-site mutation metadata is rejected as defense in depth alongside CSRF and SameSite cookies.
- Live-data redaction is enabled by default. External login backgrounds require an explicit server allowlist and matching CSP change.
- Git commits use the GitHub privacy address; the public history and release tags are republished without the previously exposed personal author address.

## Traffic integrity

- Monthly usage is calculated from persisted non-negative interface deltas grouped by interface and boot identity. Reboots, interface counter resets, and interface changes no longer erase the already measured cycle total.
- Quota input is explicitly decimal GB (`1 GB = 1,000,000,000 bytes`) instead of a GB label backed by GiB arithmetic.
- Billing-cycle day, IANA timezone, receive/transmit counting mode, and an optional current-cycle provider baseline are configurable. A baseline is tied to one cycle and is not silently reused next month.
- The overview calls the result a local estimate and exposes incomplete sample coverage instead of presenting a partial value as a provider bill.

## Reliability and truthfulness

- SQLite foreign keys are enabled, audit retention is bounded, database persistence status is reported from the successful live sample, and protocol data-source totals are no longer hard-coded.
- The read-only account view is named Account status / 账号状态 rather than implying write-capable account management.
- Runtime React tests now complement source-contract tests and backend tests.
- The public project screenshot is a real redacted browser capture rather than generated interface text.

## Upgrade notes

1. Back up `config.json`, all `state.db*` files, current frontend/backend directories, systemd unit, and Nginx site.
2. Merge the new traffic-cycle, audit-retention, redaction, and external-background keys; do not overwrite protected secrets.
3. Validate the config with the v2.5 backend before switching the live symlinks.
4. If the VPS carries the administrator's active proxy connection, do not reboot it without an independent management path and automatic rollback. Restart only CastoriceUI for normal acceptance.
5. Confirm loopback/HTTPS health reports `2.5.0`, unauthenticated dashboard access returns `401`, proxy services remain healthy, login/logout works, and the prior release is still available for rollback.
