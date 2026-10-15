# Deployment and feature prerequisites

| Environment | Qualification |
| --- | --- |
| Debian 12/13 amd64, systemd, Python 3.11+, Nginx/TLS | Supported release baseline; independent VM installation, rollback/retry and reboot gates |
| Windows with Node and Python 3.11+ | Source checks/build with project ../.castoriceui-venv; Linux host collector requires WSL/Linux or a forwarded backend |
| Current Playwright Chromium/Firefox/WebKit | Engine interaction/layout gates; actual language/theme/motion asserted per case |
| Physical Safari/iOS and stated minimum browser versions | Product support target; separate physical/minimum-version acceptance needed |
| Ubuntu/other Linux, ARM and non-systemd hosts | Not qualified by the Debian amd64 gates; do not infer compatibility from Python portability |

| Feature | Required evidence/input |
| --- | --- |
| Host resources and traffic | Readable Linux /proc and interface counters, writable SQLite; history begins at actual installation |
| Protocol status/connections | Running supported core, loopback authenticated API, actual unit/inbound mappings and fresh inventory probe |
| External business probes | Protected signing secret, agent names and explicit per-agent required protocols; unavailable observer does not prove an outage |
| Subscription validation | Protected HTTPS URLs; reachable, parseable format is distinct from actual client import and proxy forwarding |
| Panel login | Valid same-origin TLS site, Secure/HttpOnly cookies, bootstrap token for the first administrator |
| Certificate evidence | Intended public certificate, actual endpoint/port and renewal-unit evidence; not inferred from another site |

For humans and AI deployment tools: read [DEPLOYMENT](DEPLOYMENT.md), prepare protected inputs locally, generate a site for review, run read-only preflight, then use the transactional installer. Exit codes and JSON summaries distinguish validation failure, existing installation lock and rollback status. Do not invent missing credentials, silently change proxy units or treat an untested environment as qualified.
