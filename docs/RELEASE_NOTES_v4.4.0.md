# CastoriceUI v4.4.0

## Changes

- Service status now shows current CPU usage and bounded CPU/memory history for 1, 6, and 24 hours. Existing one-minute samples are aggregated into one, five, and fifteen minute points, then cached between samples.
- Traffic charts preserve the pointer inspector while the five-second dashboard refresh updates values. An error boundary retries only after its data changes.
- Traffic coverage and protocol overflow popovers now position from their trigger and remain within the viewport.
- The overview service health section is one compact, dynamic card with an accessible navigation target for every service and storage/backend state.
- Overview and traffic layouts use available chart space more effectively; the monthly and protocol cards have balanced desktop heights and responsive narrow layouts.
- A Material 3 sustained-press state layer is available on primary controls, with reduced-motion support. Setup now explains protected server prerequisites in Chinese and English.

## Upgrade

Back up the protected configuration and SQLite database before upgrading. The new resource chart reads the existing `samples` table and does not require a schema migration. Release deployment should switch only the CastoriceUI backend and frontend. Do not restart Hysteria2 or sing-box.

CPU and memory history builds from real one-minute samples. A newly installed host will not show a full 24-hour history immediately.

The web setup wizard does not create proxy cores, upstream API secrets, managed accounts, or protected subscription records. Prepare these in the root-only server configuration and use the wizard to validate their runtime integrations.
