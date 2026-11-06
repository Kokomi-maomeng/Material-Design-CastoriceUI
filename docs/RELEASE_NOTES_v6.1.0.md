# CastoriceUI v6.1.0

- Account status now opens a subscription card with the existing QR style, URL copying, and Clash and Shadowrocket import links. The separate subscription page and its navigation/customization options have been removed.
- Audit center replaces the previous audit page name throughout both languages.
- Accounts, alerts and audits share the same animated record controls: below 30 records only the total is shown; from 30 records the compact view always describes a 30-record preview, with expanded pages of 50.
- Keyboard focus indicators remain inside controls across navigation, dialogs, menus, tables, charts and settings to avoid clipping in scrollable surfaces.
- Settings now groups inactivity timeout, password changes and audit log retention under Security. Retention offers 30, 60, 90, 120, 150, 180 days or one year, defaults to 180 days, persists across restarts and removes expired records on change, startup, reads/writes and hourly cleanup.

Subscription URLs are fetched only when account details are opened and stay out of dashboard payloads and logs. Client links wrap the original HTTPS subscription without a conversion service. Physical client import remains dependent on the installed client and publisher format.
