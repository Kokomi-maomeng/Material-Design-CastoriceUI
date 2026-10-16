# CastoriceUI v5.2.1

The overview traffic chart could enlarge its axes and labels after responsive layout. Its SVG measured its own height while changing its aspect ratio, creating a sizing feedback loop. A separate CSS-sized viewport now drives both SVG dimensions, keeping chart text, pointer inspection and keyboard selection at a stable size in the overview and traffic pages.

Alert and audit filters now discard snapshots belonging to a different filter. An audit request failure is visible even when an earlier page was populated, and can be retried. The loading opacity rule is limited to the two record lists.

An already open external incident or missing-observer reminder now survives a panel backend restart with its original episode and acknowledgement. Startup observation windows still apply to new unknown conditions; missing old samples cannot establish recovery or create a false recurrence.

The v5.2 alert requirements remain in place: no evidence viewer, protected shared logs, observation windows and severity classification, combined date/status/severity filters, immediate 30/50-row toggles, pagination transitions and readable local times. Existing incident acknowledgements and configuration are preserved.

Validation includes a chart regression that fails on the previous code, all ten application pages, desktop/mobile layouts, three browser engines, record filtering and pagination, code/privacy checks, and Debian installation checks. See CI for the results of each exact revision. Physical Safari/iOS and other operating systems are outside this validation.
