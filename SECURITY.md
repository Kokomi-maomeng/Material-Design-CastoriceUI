# Security Policy

## Supported versions

Security fixes are applied to the latest release on the default branch. Operators should upgrade to the newest tag while retaining and testing a rollback release.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private security-advisory feature and include the affected version/commit, reproduction steps, expected and observed impact, and a minimal proof of concept without real credentials or production data.

## Supported production boundary

CastoriceUI v3.4 includes a browser application, application authentication, and a Python/SQLite backend. The supported boundary is:

1. Nginx terminates valid TLS and serves both the frontend and same-origin `/api/`.
2. `castoriceui-backend` listens only on `127.0.0.1` or `::1`.
3. Hysteria2 and sing-box management APIs listen only on loopback and use separate random Secrets.
4. The browser authenticates through the CastoriceUI login page; Nginx `auth_basic` is not used.
5. Protected config is `0640 root:castoriceui`; SQLite, bootstrap token, and login image state are restricted to the service identity.

The backend is not designed for direct public exposure. v3.4 supports authenticated password changes but does not implement MFA, out-of-band password reset, fine-grained roles, or multi-node federation. Deployments requiring those controls should place an audited identity-aware access layer in front of the application without bypassing CastoriceUI's session/CSRF checks.

## Authentication and sessions

- First administrator creation requires a server-generated, one-time Bootstrap Token stored with mode `0600`.
- Passwords require at least 12 characters and three character classes and are stored as salted scrypt hashes.
- Password changes require the current password and invalidate every other active session.
- Session identifiers are random, stored only as hashes server-side, time-limited, HttpOnly, SameSite=Strict, and Secure by default.
- Mutations require an in-memory CSRF token, the custom-request header, and same-origin browser metadata when supplied.
- Login failures are persisted across backend restarts, expensive password checks are serialized, and concurrent request workers are bounded to protect small VPS memory/CPU.
- Client and server both enforce a finite inactivity timeout; an authenticated session cannot be configured as permanently idle-valid.
- Logout deletes the server session and expires the cookie.

Do not set `secure_cookies: false` in production. Do not log Bootstrap Tokens, session cookies, CSRF values, passwords, or upstream Secrets.

## Secret and privacy handling

Hysteria2 and sing-box Secrets belong only in `/etc/castoriceui/config.json`. The setup UI accepts loopback endpoints and tag mappings but never accepts or persists the upstream Secret in SQLite. Failed authenticated probes are not saved as ready configurations.

Dashboard account and subscription payloads are constructed from explicit field allowlists. They exclude password hashes, session values, CSRF values other than the current authenticated session response, upstream Secrets, unknown config fields, raw configs, private keys, and full subscription URLs. Complete subscription URLs are returned only by a separate authenticated endpoint after an explicit copy/QR action.

Authenticated administrators see real configured account names, account email fields, connection source IPs, subscription account labels, audit actors, and audit source IPs so multi-account operations remain identifiable. `redact_live_data` continues to suppress connection destinations in the shared dashboard payload, while complete subscription URLs remain isolated behind the explicit authenticated copy/QR endpoint. Access control, not cosmetic masking, protects operator-only identity data.

## URL, SSRF, command, and file boundaries

- Protocol endpoints are restricted to loopback and strict no-redirect authenticated requests.
- Network probe targets undergo separate hostname/IP validation and are passed as subprocess arguments without a shell.
- HTTPS login-background URLs are fetched by the backend and served same-origin. When `external_background_hosts` is non-empty, every initial and redirected host must remain allowlisted. DNS answers must all be globally routable, and each request connects to the already validated address while preserving the original TLS SNI and Host value, closing DNS-rebinding time-of-check/time-of-use gaps. The default allowlist is empty, which permits any public HTTPS host but still rejects private, loopback, link-local, reserved, or mixed DNS answers.
- Server login images must stay within the configured directory, pass size/extension/magic validation, and cannot use nested traversal paths.
- The panel does not expose arbitrary shell execution. Protocol account writes, credential rotation, and service control require a separately designed and audited adapter.

## Deployment requirements

- Use the supplied TLS Nginx and hardened systemd examples.
- Keep prior releases and verified config/database backups before upgrades.
- Validate unit/Nginx configuration, loopback health, unauthenticated dashboard rejection, application login, CSRF mutation rejection, logout invalidation, protocol probes, and restart recovery.
- Restrict the Content Security Policy image source to known hosts when external login backgrounds are not needed.
- Run `npm run check` and review CI/CodeQL before every release.

## Repository controls

CI runs linting, type checking, frontend/backend tests, Python compilation, sensitive-content scanning, production builds, dependency audits, and CodeQL. Secret scanning, push protection, Dependabot, protected branches, manual code review, and deployment verification remain complementary controls.
