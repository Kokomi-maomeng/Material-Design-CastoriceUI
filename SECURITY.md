# Security Policy

## Supported versions

Security fixes are applied to the latest release on the default branch.

## Reporting a vulnerability

Do not disclose a suspected vulnerability in a public issue. Contact the repository maintainer privately through the security advisory feature and include:

- affected version or commit;
- reproduction steps;
- expected and observed impact;
- a minimal proof of concept without real credentials or production data.

## Scope and deployment warning

CastoriceUI is a frontend project. It does not provide production authentication, authorization, secret storage, proxy-core isolation, or operating-system privilege separation. A production deployment must supply those controls in a trusted backend.

Never expose Hysteria2, sing-box, systemd, Docker, database, or provider APIs directly to a browser. Bind privileged APIs to loopback or a protected internal network, authenticate server-to-server requests, and return sanitized models only.

## Build dependency advisory

The current vinext build tool pins `image-size@2.0.2`. GitHub reviewed two denial-of-service advisories for malformed ICNS, JXL, and HEIF parsing on August 7, 2026; no patched npm release exists yet. CastoriceUI does not accept image uploads, does not use `next/image`, and deliberately does not expose vinext's image-optimization endpoint, so this parser is not reachable in the deployed application. `npm run audit:production` excludes build-only dependencies and must remain clean. Recheck the full development dependency audit when vinext or image-size publishes a patched release.
