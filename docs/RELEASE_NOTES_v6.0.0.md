# CastoriceUI v6.0.0

- Keep the last real network probe curve through collection or connection interruptions, resume polling on return, and retain trend measurements after a refresh failure.
- Use smooth, connected RTT and loss curves with a zero baseline and an explicitly expanded latency range. Partial history buckets retain gap markers without splitting every measured point; fully missing intervals remain gaps.
- Show the first ten network alerts in a compact grid, with the total beside the heading. Move metric explanations into a hover, keyboard and touch help card.
- Share one network probe editor between the Network page and the new Network settings category. Move total traffic quota into that category.
- Centralize the ten-target policy. Validate unique order and canonical addresses, required names, address families, integer ports and DNS combinations in the browser and backend. Automatic order fills free positions; saved and reopened targets use canonical order.
- Unify editor control heights, use compact port fields, and adapt fields and alerts for narrow screens and zoom. Preserve existing global alert rules and optional ICMP/TCP/DNS behavior.
- Route development glob matching through patched upstream minimatch with a small CommonJS compatibility adapter for existing lint plugins. Keep the complete dependency audit enabled.

The update changes the panel frontend and backend. Proxy services do not require a restart. Existing settings and history remain in the protected database.
