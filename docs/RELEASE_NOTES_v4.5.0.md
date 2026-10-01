# CastoriceUI v4.5.0

This release addresses the v4.4 audit's initialization, monitoring, API, browser, deployment and maintenance findings. See [the itemized repair record](V4.5_FIX_SUMMARY.md).

- First-run completion uses the canonical traffic quota and explicit confirmation, with persistent setup state after restart.
- Collector timestamps, errors and TTLs distinguish live measurements from cached evidence. An independent watchdog records collection failures and recovery.
- Connection rates are published with monitoring samples; HTTP readers do not modify rate baselines. Traffic coverage detects missing range boundaries.
- Invalid upstream objects and JSON scalar types fail safely. Frontend dashboard validation and a page error boundary prevent malformed responses from removing the application.
- Public HTTPS fetches have one overall deadline, bounded concurrency, and background-image request sharing. Safe YAML parsing supports block/flow syntax with explicit structure limits.
- Background polling does not renew idle sessions. User activity is reported separately with CSRF protection.
- Network quality reflects missing coverage. Hostname probes support automatic/IPv4/IPv6 selection and automatic interface discovery checks IPv6 routes.
- The installer records a deployment transaction, uses unique version directories, validates the actual config/upstream, enables fresh installations, and verifies rollback results. Failure evidence and failed releases are retained for diagnosis and safe retry.
- Keyboard selection, unused CSS, account counter explanations and bilingual certificate evidence are corrected.

No proxy-core restart is required. Production operators must retain a consistent SQLite/config/unit/site backup and verify health, authenticated workflows and proxy continuity. A successful test run does not prove every protocol, physical device or minimum browser version.

Historical GitHub PR/cache metadata removal is a platform action. Cleaning current refs and using noreply metadata prevents new exposure; it does not prove that old detached objects have been deleted.
