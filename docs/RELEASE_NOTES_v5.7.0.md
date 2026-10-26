# CastoriceUI v5.7.0

The connections page now puts useful source, speed and destination information into compact cards that remain readable on phones, tablets and desktops.

- Removed empty expanded rows, aggregation counts, unknown-identity counts, rate coverage fractions and inconsistent protocol colors. Missing fields no longer take up a row.
- Added explicit live destination viewing for authenticated administrators. Targets stay hidden in the normal dashboard; the opt-in view is cleared on hide, page exit and sign-out, and is not written to connection history, logs or exports. Destinations are domain/IP and port, not complete HTTPS URLs.
- Destinations support copying, bandwidth ordering, ten-at-a-time expansion and search for long lists. A nonempty search remains clearable when polling shrinks the list. IPv6 targets use unambiguous brackets.
- Protocol/IP filters live behind one compact entry, preserve selection across polling and provide a clear empty state and reset. VLESS security variants share one protocol filter.
- Hysteria2 client instances and TCP streams are labelled separately, including online clients without TCP activity. Its current statistics API does not provide source addresses; no addresses are guessed from event logs.
- Connection rates always refer to listed, consecutively sampled entries. Overview always shows interface rates. New/short-lived entries and complete UDP traffic are outside the connection-rate total. Time means the oldest current connection, not device uptime.
- Stable group identities prevent expansion moving between sources after polling changes. Stale/failed samples do not expose destinations or fabricated current rates.
- Reminder-only alerts use a red dot. The badge number includes unacknowledged critical and warning records, using the full summary independently of pagination; typography scales with text size.
- Updated the development dependency lock to patched undici and Zod versions; production dependencies are unchanged.

Regression coverage includes populated protocol lists, 0/1/50/100 entries, long IPv6/domain targets, hidden/missing fields, polling changes, mobile/tablet breakpoints, text scaling, themes, languages and reduced motion across Chromium, Firefox and WebKit. Engine emulation does not constitute physical iOS/Android device acceptance.

Deployments retain the transactional installer, backups and rollback checks. This update requires only the panel backend restart; proxy cores and Nginx remain protected.
