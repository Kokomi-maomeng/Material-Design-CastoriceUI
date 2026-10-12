# CastoriceUI v4.7.1

This patch completes the v4.7 monitoring release by correcting external-report freshness when the observer clock is slightly ahead of the server. v4.7.0 could briefly report unavailable evidence even though a signed business check passed.

Freshness now checks server receipt time and observation time together, using the same bounded clock skew as report submission. The 180-second expiry, signatures, replay protection and two-report failure/recovery policy remain enforced. Regression coverage includes positive clock skew, expired observations, expired receipts and confirmed business failures.

Observer uncertainty also stays distinct from an active business incident during recovery. A valid observer report clears observer-only uncertainty without inventing a business failure; an already confirmed business incident survives an intervening unknown report and still requires two successful reports to recover.

All v4.7.0 monitoring, incident evidence, network policy, safe certificate activation and privacy improvements are included. See [the v4.7 implementation map](V4.7_FIX_SUMMARY.md) and [monitoring boundaries](MONITORING.md). The v4.7.0 tag remains immutable; v4.7.1 supersedes it.
