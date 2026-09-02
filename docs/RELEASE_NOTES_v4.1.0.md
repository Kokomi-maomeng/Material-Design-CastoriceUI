# CastoriceUI v4.1.0

Overview cards now open their related detail pages while preserving text selection, quota editing, range controls, and chart interaction. The active-account shortcut opens account status; the remaining connection snapshot opens connections. Service health opens services without a separate “View all” button. Hidden sidebar destinations remain reachable through shortcuts and browser history.

Host information includes memory used, total, and percentage. Protocol distribution clears its inspected segment when the pointer leaves the card, including after clicking a segment; keyboard focus and blur remain supported.

Service health now includes separate Hysteria2, AnyTLS, VLESS, SOCKS5, Shadowsocks, VMess, Trojan, and TUIC cards according to effective configuration. Both the overview and service page use the same payload and component. The shared sing-box core remains a separate component and is not counted twice as a protocol adapter.

Protocol health checks the statistics response, exact inbound tag, protocol type, VLESS security profile, and the running core's owned listening sockets. A fresh read-only inventory is required. Missing, stale, mismatched, or unavailable evidence produces an abnormal card with unavailable version/uptime instead of borrowing healthy information from the shared core. Unsaved setup forms do not change server configuration; submitting an incomplete or failed first setup retains only an abnormal intent marker. Failed candidate values never replace an existing working configuration or erase a shared API endpoint on restart.

## Upgrade

Install the new `castoriceui-protocol-probe.service` and `.timer` from `deploy/`, then enable the timer and run the first sample as documented in [DEPLOYMENT.md](DEPLOYMENT.md). The probe uses root only to read the sing-box process configuration and socket ownership; the web backend remains unprivileged. It publishes an allowlisted snapshot in `/run/castoriceui/protocol-status.json`, excluding users, passwords, UUIDs, private keys, addresses, and API secrets. It never changes or restarts a proxy service.

The probe supports the standard `sing-box` systemd unit, JSON configuration files passed with `-c`/`--config` and directories passed with `-C`/`--config-directory`. Configuration newer than the running process is reported as unverified; nonstandard launchers or unreadable configuration are also reported as abnormal. It verifies local runtime evidence, not end-to-end client reachability.

## Validation

Regression coverage includes protocol combinations, incomplete and failed setup across backend restart, shared-endpoint preservation, wrong tags and protocol types, missing listeners, stale process inventory, malformed API responses, navigation controls, selection, keyboard behavior, and donut reset. Deployment acceptance additionally checks authenticated APIs, rendered pages, database integrity, rollback readiness, and unchanged proxy processes.
