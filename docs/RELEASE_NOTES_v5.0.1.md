# CastoriceUI v5.0.1

This release fixes an upgrade defect that could leave an existing browser running the v4.6 frontend after newer files were deployed. Deterministic archive timestamps and equal-sized HTML files shared Nginx's default ETag and Last-Modified validators. Revalidation could incorrectly return 304. The installer now disables both HTML validators and sends `Cache-Control: no-store`; hashed assets retain their immutable cache policy. Existing browsers can obtain the current page with an ordinary reload.

Confirmed missing protocol listeners now remain offline even when the statistics API is unavailable. An unconfirmed recovery keeps the original outage episode open. Independent Hysteria2 failures are no longer grouped under sing-box.

Alerts offer authenticated, episode-specific first, worst and latest saved evidence. Old episodes without saved evidence are identified explicitly. Network cards expose ICMP/TCP/DNS timestamps and completeness, with 1h, 6h and 24h RTT/loss trends. Longer views use bounded queries and bucket maxima; missing/partial samples remain visible. Optional correlation diagnostics show current target directions, official incident context and resource counters with explicit uncertainty.

The v5.0 sign-in controls remain: Clear/Default/Tinted glass, card mode, automatic overflow, compact units, viewport-specific background caches and immediate/2s/5s/10s/30s/1min/2min/5min/10min durations. Tests cover these interactions together with the HTML upgrade path. See [rework coverage and limitations](V5.0.1_FIX_SUMMARY.md).
