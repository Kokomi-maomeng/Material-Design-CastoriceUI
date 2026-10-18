# CastoriceUI v5.3.2

- Ease the transition from sign-out to the sign-in background and card, and into the dashboard. Session invalidation does not wait for an animation; failed sign-out restores the current screen.
- Reset both the hash and rendered page on sign-out so signing in again consistently opens Overview.
- Animate Liquid Glass options, background source fields and automatic traffic-reset controls in both directions. Preserve drafts and keep collapsed controls out of keyboard navigation.
- Give settings and network disclosures reversible height transitions across supported browser engines, retaining native summary keyboard behavior.
- Smooth desktop sidebar centering. Keep existing page, dialog, menu, chart, record-list and mobile drawer motion.
- Respect reduced-motion preferences, including when they change during a disclosure animation.

Deployment restarts only the panel backend. Existing settings, incident history and proxy services are preserved.
