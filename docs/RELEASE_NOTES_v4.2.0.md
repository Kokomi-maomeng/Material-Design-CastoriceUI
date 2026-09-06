# CastoriceUI v4.2.0

This release closes all P1, P2, and P3 findings from the v4.1.0 audit. It keeps unavailable evidence explicit instead of substituting zeroes, static configuration, or host-wide counters.

## Reliability and accounting

- sing-box 1.13 inbound metadata and the live protocol inventory are cross-checked before connections are classified.
- Traffic quota settings now have one restart-safe SQLite source shared by setup and settings. The bounded delta ledger handles interface or boot changes, independent receive/transmit resets, calendar boundaries, sampling gaps, and five-year queries without loading raw history.
- Network targets, alert episodes, acknowledgement times, recovery times, and retention are persisted. Background monitoring no longer depends on a browser request.
- Connection-rate summaries disclose partial coverage, account rows separate protocol-core lifetime counters from the host billing-cycle ledger, and missing measurements remain unavailable.

## Security and operations

- Management and subscription probes are bounded by size and total time, never follow redirects, and never forward authorization to another origin. Subscription checks distinguish HTTPS reachability from successful parsing and require valid node structure.
- Deployment now includes a read-only conflict preflight, explicit new-install/existing-host/upgrade paths, secret-free examples, an environment file for the protocol probe, and Debian 12/13-compatible Nginx templates.
- Release archives use a sorted manifest and normalized timestamps so repeated builds from the same source produce the same SHA-256 checksum.
- Certificate status distinguishes unconfigured, unreadable, expiring, expired, and valid states. Endpoint-certificate and renewal-unit evidence are reported separately and are not presented as successful renewal history.

## Interface and compatibility

- Traffic-chart selection survives shrinking, empty, malformed, and restored series without taking down the page.
- Logout failures preserve the authenticated UI; validation errors use stable, field-aware messages; IPv6 loopback and supported inline core arguments are handled correctly.
- Browser support is documented and enforced for Chrome/Edge 111+, Firefox 113+, and Safari 16.4+. Large UI and stylesheet modules were split and stale code/version copy removed.

## Upgrade

Back up the protected server configuration, `state.db*`, current frontend/backend releases, systemd units, and Nginx site before replacing files. Install the updated backend, frontend, protocol-probe service/timer, and environment example. Run the read-only preflight and the checks in [DEPLOYMENT.md](DEPLOYMENT.md); do not restart proxy cores for a dashboard-only upgrade.

## Validation

The release gate covers lint, TypeScript, source contracts, React runtime behavior, Python backend integration, sensitive-content scanning, production build, dependency audit, browser matrices, Debian Nginx syntax, release archive integrity, production API and persistence checks, SQLite integrity, proxy-process continuity, and rollback readiness.
