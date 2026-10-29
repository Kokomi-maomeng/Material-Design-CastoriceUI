# CastoriceUI v5.9.0

- Keeps target cards the same size with a compact latency, jitter and loss strip. The fixed footer shows ICMP and configured TCP or DNS (UDP) measurements; unconfigured protocols keep their space without extra labels or status prose.
- Unifies **Network probes** and **Trend history** charts at the same size. Both show latency and packet loss, minimum and maximum latency to one decimal place, real observation times, keyboard access, and animated tooltips that respect reduced motion.
- Collects one real ICMP observation per second into a bounded 60-point live series. Optional TCP/DNS probes run separately. Historical ranges use up to 60 time buckets and preserve missing observations rather than presenting gaps as healthy samples.
- Removes per-target latency/loss overrides and redundant threshold, window and evidence summaries. Global alert rules remain in effect and appear with network alerts in a separate card. The network editor saves targets and global latency/loss rules together while preserving the traffic rule.
- Measures TCP connection time and validated DNS response time independently of process startup overhead. Changing the selected IP family starts a separate live series and history cache.

The supported deployment baseline remains Debian 12/13 amd64 with systemd. Upgrades use versioned directories and restart only the panel backend. See [integration details](INTEGRATION.md), [monitoring](MONITORING.md), [deployment](DEPLOYMENT.md), and CI for validation of each exact revision.
