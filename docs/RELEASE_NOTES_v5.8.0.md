# CastoriceUI v5.8.0

- Combines connection rates, filters and display controls in one responsive card. Total upload appears before total download and stays consistent while filtering the list.
- Replaces the live-destination action with a named **Show live connections** switch and visible On/Off state. Enabling it immediately expands available destinations; disabling it or leaving the page clears them.
- Shows IPv6 destination addresses without brackets, with the port shown separately. Copy buttons copy the address. Endpoint data retains its standard syntax for reliable parsing.
- Removes the connection measurement help section and the network correlation/official-incidents section, including the fixed provider poll and automatic route-context task. Custom target probes, history, layered evidence and alerts continue independently.
- Reuses the protocol registry for configured inbound labels, validates compressed IPv6 sources, rejects ambiguous or contradictory inbound mappings, and keeps listener names separate from authenticated accounts.

Configuration regressions cover AnyTLS, VLESS and its supported security profiles, SOCKS5/mixed, Shadowsocks, VMess, Trojan and TUIC through saved wizard settings, custom inbound tags, IPv4/IPv6, TCP/UDP metadata and sampled rates. These tests do not establish real client interoperability for protocols absent from a deployment. Source addresses and authenticated accounts are displayed only when supplied by the core; the Hysteria2 stream API does not currently supply a source address.

The supported deployment baseline remains Debian 12/13 amd64 with systemd. Upgrades use versioned directories and restart only the panel backend. See [integration details](INTEGRATION.md), [monitoring](MONITORING.md), [deployment](DEPLOYMENT.md), and CI for validation of each exact revision.
