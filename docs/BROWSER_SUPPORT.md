# Browser support

CastoriceUI's supported minimum browser versions are:

| Browser | Minimum version |
| --- | ---: |
| Google Chrome | 111 |
| Microsoft Edge | 111 |
| Mozilla Firefox | 113 |
| Apple Safari on macOS | 16.4 |
| Apple Safari on iOS/iPadOS | 16.4 |

These versions form a product support contract, not merely a JavaScript syntax target. Authentication, navigation, dialogs, scrolling, settings, and charts must remain operable at the stated minimums. Newer CSS motion features are progressive enhancements: an unsupported transition may become instantaneous, but content and controls must remain available. The build target and `browserslist` entry are kept in sync with this table.

Before a release, run the automated unit/build gates and the available Chromium, Firefox, and WebKit interaction matrix. A real Safari/iOS check is required before claiming that a specific Apple device/browser combination was physically validated; a current Playwright WebKit run is supporting evidence, not a substitute for that claim.

The v4.6 scrollbar regression script uses headed Firefox because its headless automation runtime forcibly hides scrollbars. On Linux, run `xvfb-run -a python3 scripts/browser-v46.py firefox`; CI supplies the virtual display. Chromium removes its default `--hide-scrollbars` launch argument. The visibility and layout assertions remain enabled for every engine.

The v5.0 matrix also checks all four login appearances in light/dark themes at desktop and narrow/short viewport sizes, natural select-menu overflow, keyboard focus after popup placement, pending critical acknowledgements, authenticated reloads, and cached image recovery after network/decode failures. It uses a fresh temporary persistent browser profile because WebKit's ephemeral context discards Cache API entries on reload; no actual user profile is used. Chromium additionally exercises autofill styling, magnified visual viewport placement and reduced transparency. Glass uses a single static backdrop blur; browsers without that CSS feature, or users requesting less transparency or more contrast, receive an opaque surface. The browser engine matrix does not establish performance or visual parity on physical Apple devices.
