# CastoriceUI v6.6.0

This update addresses the v6.5 security, data and deployment review.

- Release archives ship with normalized root ownership and file modes. The installer rejects writable release paths, links and unsafe archive members. Host preflight checks private config and state permissions.
- Login and initialization require guarded JSON requests. Audit search sends the filter in the authenticated request body. External background recovery is tied to the image version and limited per cache entry.
- Network bulk confirmation affects network alerts only. Audit retention accepts 7–3650 days. Concurrent edits merge without dropping unrelated changes.
- Quota resets use a single UTC boundary for daylight-saving transitions. Traffic analytics labels interface usage, listed connection rates and each core's cumulative counters separately.
- DNS probes verify resource records. Hysteria2 reports endpoint health independently. Account identity mappings reject duplicates and subscription validation skips malformed entries while reporting counts.
- Upgrades drain the panel before taking the final rollback snapshot. The target host runs focused checks, while full regression and installation tests remain in CI. The TLS site generator supports IPv4, IPv6 and dual-stack listeners.
- Login text has a stable background under every glass preset. Keyboard focus works without the CSS parent selector, and redundant overview meters are hidden from assistive technology.

For installation, upgrade and rollback, see [Deployment and recovery](DEPLOYMENT.md). An upgrade from an older Windows-built archive may require verifying and securing the existing release directory before installing. See the same guide for that step.
