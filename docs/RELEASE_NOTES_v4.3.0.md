# CastoriceUI v4.3.0

CastoriceUI v4.3.0 is a focused interaction, correctness, security, and release-safety update. It preserves protected server configuration, SQLite state, traffic history, and proxy-core processes during the panel-only upgrade.

## Interface and motion

- Adds coordinated Material Design 3 enter and exit motion to dialogs, setup/configuration windows, selectors, date pickers, menus, the mobile drawer, disclosures, connection details, protocol overflow content, and coverage information.
- Makes the complete protocol summary row toggle connection details and keeps the animated disclosure indicator at the leading edge, including narrow and horizontally scrollable layouts.
- Gives the traffic trend the full content width, then places recent monthly traffic beside protocol distribution. The protocol legend supports five visible rows and a responsive hover, keyboard, or touch overflow surface whose items continue to inspect the donut chart.
- Moves incomplete traffic-coverage detail from a permanent banner into an anchored information control, without hiding the partial-coverage labels on affected monthly periods.
- Removes the protocol-lifecycle versus panel-quota explanatory copy from account status and renames registration-state labels to account enabled/disabled in Chinese and English.
- Positions select and date surfaces from their measured height so a lower trigger opens beside itself rather than jumping to the top of a dialog.

## Backend and security

- Validates candidate sing-box protocol mappings against an inventory read using that candidate configuration.
- Strictly validates alert threshold object shape, numeric type, finiteness, and ranges both at configuration load and wizard submission.
- Rejects overlong wizard values and more than 12 non-empty network-target lines instead of silently truncating them.
- Separates storage health from optional protocol-adapter health and adds a global failed-login budget alongside the per-source budget.
- Requires `ping` and `ip` in the read-only deployment preflight, documents their Debian packages, and adds one-year HSTS to every Nginx response path that owns headers.

## Release and compatibility

- Adds a versioned, staged `deploy/install-or-upgrade.sh` flow with safe archive validation, online SQLite backup, atomic frontend/backend link switching, panel-only restart, versioned health verification, and failure rollback.
- Updates locked dependencies, including the fixed `js-yaml` and Vitest releases, with zero known npm audit findings at release qualification.
- Aligns the documented and compiled Apple browser floor at Safari/iOS 16.4. Playwright WebKit remains supporting automation; no claim is made that this release was physically tested on a fixed Safari or iOS device.
- Refreshes repository artwork without a version badge or simulated Dynamic Island. The phone Overview and diagonal light/dark desktop presentation are browser captures of the actual v4.3 interface using a privacy-safe sample API payload; no product UI is generated or redrawn.

Frontend and backend versions are `4.3.0`. Follow [DEPLOYMENT.md](DEPLOYMENT.md) and keep the printed backup directory until post-deployment checks pass. The installer never restarts Hysteria2 or sing-box.
