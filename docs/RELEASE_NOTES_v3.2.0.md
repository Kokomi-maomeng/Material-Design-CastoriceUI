# CastoriceUI v3.2.0

CastoriceUI v3.2.0 focuses on operator clarity, stable live layouts, and portable runtime truthfulness.

## Highlights

- Removes cosmetic masking from authenticated account names, account email fields, connection source IPs, subscription account labels, audit actors, and audit source IPs while keeping Secrets and full subscription URLs server-side
- Adds year and month selection layers to the Material date picker used by traffic quota scheduling
- Uses fixed Active connections columns so changing rates and identifiers cannot resize neighboring fields
- Replaces compressed network sparklines with responsive point-and-line trend charts that preserve their aspect ratio
- Reorganizes Settings into collapsible General, Theme style, and Page customization groups and removes redundant helper text
- Moves the compact service-health result beside the Refresh action and removes the duplicate live-check badge
- Removes terminal Chinese and English sentence periods from rendered interface copy while preserving punctuation between sentences
- Stops treating guessed interfaces, unverified subscription publishers, unreachable probe sets, or unwritable SQLite storage as healthy
- Keeps unmapped protocol identities unattributed instead of assigning or proportionally inflating account traffic

## Upgrade

No protected configuration migration is required. Preserve the existing SQLite database and protected config, create a verified online database backup, deploy matching v3.2.0 frontend/backend assets, restart only `castoriceui-backend`, reload Nginx, and verify login, account identity display, traffic quota date selection, connection column stability, service/integration states, proxy continuity, and rollback readiness.
