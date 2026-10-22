# CastoriceUI v5.6.0

This maintenance release addresses the ten findings from the v5.5 audit.

- Storage-capacity alerts include stable episode times, including existing records. A malformed alert row is isolated with a visible diagnostic count instead of blocking valid dashboard metrics.
- Unknown database capacity remains `null` and displays as unavailable while writable sampling and the rest of the panel continue.
- Connection readiness follows the configured HY2/sing-box sources and their freshness. Partial coverage is explicit; an unconfigured optional core is not a failure dependency.
- Pending, failed and stale network targets retain explicit threshold overrides, TCP/DNS options and ordering during repeated edits.
- Violet dark mode has a paired primary color. Error badges and filled danger buttons use theme-aware foreground colors.
- Vite is locked to 8.3.5 and Vitest to 4.1.12. The full dependency audit joins the production audit in the required check.
- Background API URLs reject malformed, empty, zero and out-of-range ports before saving and identify the invalid field.
- Support, integration routes, quota help and offline package links match current capabilities.
- Source tools declare `^20.19.0 || ^22.12.0 || >=24.0.0`, report runtime versions and reject unsupported Node versions before source checks/builds. Installed server packages do not need Node.

Production upgrades use the existing transactional installer, protected data backup and atomic release switch. Only the panel backend needs restarting; proxy cores remain running. Read [deployment and recovery](DEPLOYMENT.md) and [the API contract](INTEGRATION.md) for prerequisites and evidence boundaries.
