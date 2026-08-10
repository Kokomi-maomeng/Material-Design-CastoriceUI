# Security Policy

## Supported versions

Security fixes are applied to the latest release on the default branch. Operators should upgrade to the newest tagged version and keep a tested rollback release.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue. Use the repository's private security-advisory feature and include:

- affected version or commit;
- reproduction steps;
- expected and observed impact;
- a minimal proof of concept without real credentials or production data.

## Security boundary

CastoriceUI v1.3 includes a browser frontend and an optional Python backend. The backend collects local Linux metrics, queries loopback-only Hysteria2 and sing-box management APIs, and stores bounded operational history in SQLite. It is not an identity provider and must not be exposed directly to the internet.

The supported production boundary is:

1. Hysteria2 and sing-box management APIs listen on loopback and use separate random Secrets.
2. `castoriceui-backend` listens on `127.0.0.1` only.
3. Nginx provides TLS and authentication for both the static frontend and `/api/`.
4. Multi-user deployments replace Basic Auth with an authentication proxy that provides secure sessions, CSRF protection, MFA, authorization, and rate limits.

The browser never receives upstream API Secrets, raw configuration files, private keys, stored passwords, or complete subscription URLs in the dashboard snapshot. Subscription URLs are returned only by a separate authenticated endpoint after an explicit copy or QR action.

## Secret handling

Upstream Hysteria2 and sing-box Secrets belong only in `/etc/castoriceui/config.json`, owned by `root:castoriceui` with mode `0640`. v1.3 does not accept those Secrets from the setup UI and does not persist them in SQLite. On startup, it removes any legacy v1.2 `secret` value found in the `integration_overrides` setting.

The setup API accepts only loopback management endpoints, rejects embedded URL credentials, query strings, and fragments, and performs a real authenticated upstream request before reporting a ready state. Failed validation is not persisted.

## Deployment requirements

- Use the authenticated TLS Nginx example; do not publish the loopback backend port.
- Keep `/etc/castoriceui/config.json` and certificate groups least-privileged.
- Validate `systemd-analyze verify`, `nginx -t`, unauthenticated rejection, authenticated API access, and the loopback health endpoint before switching releases.
- Back up the application config, SQLite database, service unit, Nginx site, and previous frontend release before upgrading.
- Run `npm run check` and review the full development-dependency audit before each release.

## Automated repository controls

The default branch runs linting, type checking, frontend/backend tests, Python compilation, sensitive-content scanning, production builds, dependency audits, and CodeQL. GitHub secret scanning, push protection, Dependabot updates, and protected-branch checks complement these project checks; they do not replace deployment hardening or manual review.
