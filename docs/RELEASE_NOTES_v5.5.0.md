# CastoriceUI v5.5.0

The alert center now shows concise record details: monitoring source, occurrence count and the latest repeated occurrence. Database internals, file paths and shell commands are no longer shown or returned by the alert API.

Text uses a shared sans-serif stack and relative size scale throughout the panel. Small labels, tables, charts, connection details and dialogs use readable sizes, consistent number rendering and the same form-control fonts.

External AnyTLS/HY2 observer monitoring has been removed, including its reporter, report endpoint, configuration, service-health entries and alert policy. Upgrades remove only its stored samples, incidents and replay tokens. Local core/listener checks, network measurements, certificate monitoring and unrelated history remain active. Protected deployment backups remain available for rollback.

The qualified server baseline remains Debian 12/13 on amd64 with systemd. Browser-engine checks do not establish physical Apple-device acceptance. Historical platform privacy cleanup remains separate from new-content release checks.
