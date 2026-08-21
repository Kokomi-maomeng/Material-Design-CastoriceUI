# CastoriceUI v3.1.0

CastoriceUI v3.1.0 is a focused correctness and interface-polish release.

## Highlights

- Reconciles account and protocol analytics to the same durable interface ledger used by Overview, while retaining the live core counters as attribution weights.
- Prevents traffic-trend deltas from crossing interface or boot-counter boundaries.
- Adds a real authenticated password-change endpoint and Settings workflow; the current password is required and other sessions are invalidated.
- Replaces every native select and date picker in the application with Material-styled, keyboard-accessible surfaces, including a searchable complete IANA timezone list.
- Expands traffic chart plotting coordinates to the measured container aspect ratio instead of stretching the SVG or leaving wide-screen gutters.
- Refines Setup completion colors and pending placement, moves sign-in background controls under Theme color, removes requested explanatory text, and shortens the audit result count.

## Upgrade notes

No protected configuration migration is required. Preserve the existing SQLite database and protected config, create a consistent database backup, deploy matching v3.1.0 frontend/backend assets, and verify login, password change, traffic equality across Overview/Accounts/Traffic, timezone/date pickers, responsive charts, and rollback readiness.
