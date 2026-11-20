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

## Release checks

- The browser matrix covers desktop and narrow screens, light and dark themes, English and Chinese, system language selection, modal and menu focus, keyboard slider controls, and reduced motion.
- The first-run suite uses a real Linux backend and SQLite. It follows one-time administrator creation, validation, setup after a refresh or sign-in, and the first live dashboard.
- Sign-in appearance checks cover image failure recovery, ordinary refresh with a session, and signing out from a non-overview page. Cached-image tests use a temporary persistent browser profile. Users requesting reduced transparency or more contrast receive a solid sign-in surface.
- The scrollbar check runs Firefox with a visible browser because headless Firefox hides scrollbars. On Linux, use `xvfb-run -a python3 scripts/browser-v46.py firefox`. CI supplies the virtual display. Chromium removes its default `--hide-scrollbars` argument.
