# CastoriceUI v4.7.0

Monitoring now distinguishes confirmed service failure from unavailable statistics and missing protocol evidence. Normal startup publishes a consistent snapshot before alert evaluation. Independent collectors keep network and subscription timeouts from holding up core monitoring.

- Network alerts use a 120-second packet-weighted window, at least 24 packets, two abnormal rounds out of three, and two healthy rounds for recovery. Individual abnormal samples remain visible. Configured TCP/DNS failure can corroborate complete ICMP loss immediately.
- Seven-day monitoring evidence has a 180,000-row capacity limit. Alert episodes retain first, last and worst evidence separately. Recovery and acknowledgement remain separate.
- Active, recovered pending and all-history filters separate current problems from review work. Network charts distinguish this round's replies from measured time history, with gaps preserved.
- A read-only lifecycle hook refreshes inventory on the next natural core start; a 10-second timer provides fallback. Generation checks include boot ID, PID and process start ticks.
- The optional certificate receiver validates and backs up both files, uses same-filesystem replacement, verifies AnyTLS TLS and a pinned HY2 business connection, and restores old files on failure. It never restarts proxy cores. Install it separately after validating the actual binaries and site configuration.
- An isolated external AnyTLS/HY2 agent checks established and new business connections. Signed reports reject expired, replayed and malformed evidence; observer failures remain separate from business warnings. Resource pressure, task timing, official incident context and rate-limited route evidence improve diagnosis without asserting an unsupported root cause.
- Repository privacy hooks, complete Git identity/content checks and final-archive scanning are included. Updated a vulnerable development dependency.

The public health endpoint explicitly reports panel liveness. External probes cover their own vantage point. Dedicated test identities require safe support from the core's authentication mode; adding monitoring alone does not migrate shared-password authentication. Historical outages and provider responsibility cannot be reconstructed from new samples. High availability remains a separately evaluated architecture; this release does not install a second node or change proxy resource limits.
