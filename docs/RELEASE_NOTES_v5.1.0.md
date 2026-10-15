# CastoriceUI v5.1.0

This release addresses the 27 findings from the v5.0.1 audit and its follow-up review.

- Keep loopback management credentials out of environment proxies. Serialize password verification/session issuance with password changes, bound password work, and avoid persistent account lockout caused by failures from unrelated sources.
- Preserve quota schedules, baselines, target identities and advanced probe policies across setup/editor saves and restarts. Use one network-quality policy across pages, show recovery observation, and display actual quota overuse.
- Share subscription fetch capacity, report unchecked subscriptions explicitly, and support per-observer protocol assignments. Provide a selectable address when clipboard copying fails.
- Plot resource/traffic history against actual timestamps and preserve gaps. Save typed quota evidence and isolate optional SQLite sidecar diagnostics from host sampling.
- Archive only recovered, acknowledged episodes after verifying private archive contents and checksums. Retain active/unacknowledged records and warn about capacity pressure.
- Add an installer process lock, custom-unit continuity checks, protected lifecycle allowlists, stricter TLS-site preflight, a public HTTPS doctor check and a site generator with consistent non-standard ports.
- Document isolated Python environments, Windows timezone data, supported environments and local maintenance. Correct actual language/theme/motion coverage in browser QA and use documentation addresses in synthetic display data.

See [the itemized fix summary](V5.1_FIX_SUMMARY.md) and [deployment/recovery instructions](DEPLOYMENT.md).

Upgrade keeps the proxy cores running and preserves panel state. Only the panel backend restarts; Nginx reloads if its site changes. Back up and retain the previous compatible release/database/configuration before upgrading.

The qualified server baseline remains Debian 12/13 with systemd on amd64. Browser-engine checks do not establish physical Apple-device or minimum-version acceptance. Other Linux distributions, ARM hardware, new proxy implementations and external client imports need their own acceptance. Historical platform-cache privacy cleanup is independent of this release.
