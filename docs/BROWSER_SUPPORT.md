# Browser support

CastoriceUI's supported minimum browser versions are:

| Browser | Minimum version |
| --- | ---: |
| Google Chrome | 111 |
| Microsoft Edge | 111 |
| Mozilla Firefox | 113 |
| Apple Safari on macOS | 16.2 |
| Apple Safari on iOS/iPadOS | 16.2 |

These versions form a product support contract, not merely a JavaScript syntax target. Authentication, navigation, dialogs, scrolling, settings, and charts must remain operable at the stated minimums. Newer CSS motion features are progressive enhancements: an unsupported transition may become instantaneous, but content and controls must remain available. The build target and `browserslist` entry are kept in sync with this table.

Before a release, run the automated unit/build gates and the available Chromium, Firefox, and WebKit interaction matrix. A real Safari/iOS check is required before claiming that a specific Apple device/browser combination was physically validated; a current Playwright WebKit run is supporting evidence, not a substitute for that claim.
