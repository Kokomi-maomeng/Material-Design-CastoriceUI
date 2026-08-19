# CastoriceUI v2.6.0

v2.6 focuses on configurable traffic accounting, stable live layouts, and completing settings that previously looked interactive but could fail without visible feedback. It remains compatible with the protected v2.5 configuration and SQLite state.

## Highlights

- Traffic quota reset is off unless explicitly enabled, and can be scheduled by an interval of days, weeks, months, or years using a custom anchor date and IANA timezone. The backend calculates the active cycle and next reset from the same persisted parameters returned to every page.
- Quota save failures stay inside the open dialog and remain visible above the blur layer. Existing v2.5 quota-only requests remain compatible.
- Connection rate columns and detail positions no longer disappear while rates are zero or temporarily unavailable. Redacted Hysteria2 destinations are omitted instead of being labelled as a hidden address.
- Traffic analytics removes capacity forecasting and gives the real traffic chart and account ranking stable full-width layouts.
- Network probes refresh on the five-second dashboard cycle and use a wider, responsive sparkline layout.
- Automatic-update and audit-retention presentation cards, cached-probe wording, probe notes, and meaningless certificate uptime are removed.
- Login backgrounds expose the configured server image directory, support cover/contain and position controls, and can consume public HTTPS image APIs that return an image, redirect, or supported JSON URL field.
- Setup visibility and all eight panel switches update optimistically, persist through the backend, and report save failures.
- Alert generation, acknowledgement persistence, and recurring-episode behavior have direct backend regression coverage without restarting production services.

## Upgrade notes

1. Back up `/etc/castoriceui/config.json`, all `/var/lib/castoriceui/state.db*` files, the current frontend/backend targets, systemd unit, and Nginx site.
2. Deploy frontend and backend from the same v2.6.0 artifact.
3. Preserve the v2.5 release directories and backup until quota persistence, settings switches, login background selection, live probes, and rollback have been verified.
4. Do not restart Hysteria2 or sing-box for this upgrade.
