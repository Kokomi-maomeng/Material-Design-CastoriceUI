# CastoriceUI v3.0.0

CastoriceUI v3.0.0 focuses on concise operational presentation, reliable settings, and clearer network-quality visualization while preserving the existing live-data and security boundaries.

## Highlights

- Removed redundant explanatory banners, status cards, estimate-completeness UI, account notes, and subscription token/configuration metadata from the browser payload and interface.
- Redesigned network targets as independent responsive cards, each retaining live reachability, latency, jitter, loss, filtering, history, and editing.
- Added the shared traffic-quota entry to Settings and renamed its timezone field to “时区设定 / Timezone”.
- Fixed panel-visibility and Setup-page switches with clear on/off styling, pending-state protection, current-state remounting, and rollback on failed saves.
- Preserved public non-standard HTTPS ports in Nginx proxy headers and canonical same-origin checks, fixing `origin_mismatch` on authenticated mutations.
- Audited Chinese and English rendering, onboarding flow, responsive layouts, and removed obsolete presentation code.

## Upgrade notes

- Keep `/etc/castoriceui/config.json`, the complete SQLite state set, certificates, login backgrounds, and current release as rollback material.
- Install the supplied Nginx header changes before validating authenticated settings through a public non-standard port.
- Restart only `castoriceui-backend` for the backend upgrade. Do not restart Hysteria2, sing-box, or the host as part of this release.
- Run the checks and production validation in [`DEPLOYMENT.md`](DEPLOYMENT.md) before removing the previous release.
