# CastoriceUI v5.0.0

Pending critical alerts now pulse in the notification button until every critical episode is manually acknowledged. Recovery alone does not acknowledge an episode. Alert counts, filtering and history remain unchanged.

Sign-in uses a frosted glass card with Clear, Default and Tinted presets. Default is the middle preset. Expand Liquid Glass below Image fit to adjust it, or select Use card appearance to disable glass and its slider. Reduced transparency, increased contrast and browsers without backdrop filtering use an opaque fallback. This is a lightweight web interpretation of Liquid Glass, using one static blur rather than a native Apple renderer.

Scrollbars appear when content overflows, without reserving unused tracks in the page, dialogs, menus or date pickers. Sign-in fields, autofill surfaces and adjacent form controls have consistent sizing. Long menus remain scrollable and follow the visible viewport at small sizes.

Image position has been removed. Image fit remains, with centered placement. Background duration offers immediate refresh, 2s, 5s, 10s, 30s, 1min, 2min, 5min and 10min. Immediate refresh is the default. Durations apply when entering/reloading sign-in, including logout; there is no background slideshow or polling timer. An expired image stays visible until a replacement loads successfully. API images can be up to 30 MB; server-directory images retain their 5 MiB limit.

Eight coarse viewport classes have independent caches, so portrait phones, 1080p and 2k layouts do not reuse one shared server cache entry. Background requests do not use visitor identifiers, IPs or authentication cookies. Global upstream concurrency, request/byte budgets, failure backoff and bounded disk/browser caches protect the panel from window/size cycling. Dense bursts may reuse the last image; random providers can independently return the same image.

Compact time units now use s/min/h/d across languages; binary memory/rate displays use KiB/MiB/GiB, and decimal traffic/quota values retain KB/MB/GB. See [implementation and validation](V5.0_FIX_SUMMARY.md) and [background API contract](INTEGRATION.md#login-background-lifecycle).
