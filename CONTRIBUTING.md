# Contributing

Thank you for helping improve CastoriceUI.

## Development

1. Create a focused branch.
2. Install the locked dependencies with `npm ci`.
3. Keep protocol-specific logic behind the shared types and provider boundary.
4. Run `npm run check` before opening a pull request.
5. Include screenshots for meaningful visual changes and test desktop and mobile widths.

`npm run dev` serves HTTPS on `127.0.0.1` with a generated development certificate and proxies `/api/` to the loopback backend on port `18080`. Run the backend separately on Linux/WSL, or use an SSH local port forward. `CASTORICEUI_DEV_API_TARGET` may override the target only with an HTTP loopback URL; do not disable Secure cookies for development.

## Quality expectations

- Keep pages focused and reusable components small.
- Preserve keyboard navigation, visible focus, semantic labels, and reduced-motion behavior.
- Avoid unnecessary client state, large dependencies, polling loops, and expensive visual effects.
- Use CSS design tokens rather than hard-coded colors inside components.
- Add new protocols as data values or server adapters, not duplicated page implementations.

## Security

Before every commit, inspect the staged diff and scan for credentials. Never commit real IP inventory, passwords, private keys, access Tokens, cookies, subscription links, `.env` files, or exported production data. Use RFC 5737/3849 documentation addresses and `example.test` in examples.

Security vulnerabilities should be reported privately as described in `SECURITY.md`.
