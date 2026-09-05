# CastoriceUI design system

CastoriceUI follows Material Design 3 principles without depending on a heavyweight component framework.

## Foundations

- **Typography:** locally packaged Roboto Variable with system CJK fallbacks.
- **Icons:** locally packaged Material Symbols Rounded.
- **Color:** semantic CSS tokens for primary, secondary, tertiary, surfaces, outline, error, success, warning, info, and charts.
- **Shape:** 8–32 px corner scale; containers use the larger end of the scale.
- **Elevation:** restrained shadows for floating or emphasized surfaces; most hierarchy comes from tonal surfaces.
- **Motion:** short, easing-based transitions with a complete `prefers-reduced-motion` fallback.

## Responsive behavior

| Width | Navigation | Content behavior |
| --- | --- | --- |
| Above 1180 px | Full navigation rail | Dense multi-column layout |
| 901–1180 px | Compact icon rail | Reduced card metadata |
| 681–900 px | Modal drawer | Two-column cards where useful |
| Up to 680 px | Modal drawer | Stacked cards and card-style tables |

## Component rules

- Buttons use filled, tonal, outlined, text, and danger variants.
- Chips represent selection, filters, protocol labels, and low-emphasis state.
- Data tables become labeled cards on small screens rather than horizontal micro-text.
- Charts use semantic tokens and remain legible in both color schemes.
- Dialogs use a small project-owned modal with focus trapping, Escape handling, focus restoration, and a browser-independent backdrop.
- Status is never communicated through color alone; every indicator includes text or an icon.

## Adding a theme color

1. Add the new `ThemeColor` value in `components/CastoriceApp.tsx`.
2. Add its selector overrides in `app/globals.css` for both light and dark themes.
3. Confirm text and status contrast in both modes.
4. Test charts, focus rings, selected navigation, buttons, and dialogs.

Minimum browser versions and the progressive-enhancement boundary are defined in [BROWSER_SUPPORT.md](BROWSER_SUPPORT.md).
