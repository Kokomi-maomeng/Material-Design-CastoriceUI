# Contributing

Thank you for helping improve CastoriceUI.

## Development

1. Create a focused branch.
2. Install the locked dependencies with `npm ci`.
   Create `../.castoriceui-venv` with `python3 -m venv ../.castoriceui-venv` (Windows: `python -m venv ../.castoriceui-venv`), then run `node scripts/python-run.mjs -m pip install -r server/requirements.txt`. Debian source environments need `python3-venv`. The npm checks prefer the project interpreter; `CASTORICEUI_PYTHON` can select an existing interpreter for the current process.
   Install the local privacy hooks with `npm run privacy:install` and verify `npm run privacy:identity` before committing.
3. Keep protocol-specific logic behind the shared types and provider boundary.
4. Run `npm run check` before opening a pull request.
5. Include screenshots for meaningful visual changes and test desktop and mobile widths.

`npm run dev` serves HTTPS on `127.0.0.1` with a generated development certificate and proxies `/api/` to the loopback backend on port `18080`. Run the backend separately on Linux/WSL, or use an SSH local port forward. `CASTORICEUI_DEV_API_TARGET` may override the target only with an HTTP loopback URL; do not disable Secure cookies for development.

## Quality expectations

Install the release browser test runtime with `python -m pip install playwright==1.58.0` and `python -m playwright install chromium firefox webkit`. With Vite running, execute `python scripts/run-browser-suite.py chromium layout` and `python scripts/run-browser-suite.py chromium behavior`. Run `python scripts/browser-first-run.py chromium` to exercise the real HTTP API, bootstrap token and SQLite using temporary synthetic state. Browser scripts use loopback ports and never require production credentials. The browser fixtures are suitable for repeatable screenshots. For design reviews, begin with 390×844 and 1440×1000 and check 320 px for overflow.

Health returns a JSON object such as `{"status":"ok","version":"6.6.0","setupRequired":false,"scope":"panel-liveness"}`. The unauthenticated dashboard returns 401. Open [the API contract](docs/INTEGRATION.md) before changing a fixture or response. Use `npm run test:runtime -- --maxWorkers=1` to diagnose Windows timeouts with the same assertions and record worker count and Node version with the test result.

The Debian VM tests use dated official images and verified SHA-512 values in `scripts/debian-images.json`. To update a pin, take the exact filename and hash from that build's official checksum list and rerun both Linux installation jobs.

- Keep pages focused and reusable components small.
- Preserve keyboard navigation, visible focus, semantic labels, and reduced-motion behavior.
- Avoid unnecessary client state, large dependencies, polling loops, and expensive visual effects.
- Use CSS design tokens rather than hard-coded colors inside components.
- Add new protocols as data values or server adapters, not duplicated page implementations.

## Security

Before every commit, inspect the staged diff and scan for credentials. Never commit real IP inventory, passwords, private keys, access Tokens, cookies, subscription links, `.env` files, or exported production data. Use RFC 5737/3849 documentation addresses and `example.test` in examples.

Security vulnerabilities should be reported privately as described in `SECURITY.md`.

Follow [the privacy gate](docs/PRIVACY_RELEASE_GATE.md) for staged objects, pushed history, Git identities, web merges and final release archives. Keep private-value lists outside this repository. Never bypass failed checks; inspect the actual remote merge metadata before tagging or publishing.
# Development glob compatibility

The development toolchain replaces legacy minimatch dependencies with the local
`scripts/minimatch-compat.mjs` adapter loaded by the lint command. It preserves both callable CommonJS and named
APIs while delegating matching to upstream minimatch 11.0.1, which fixes
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
The adapter contains no pattern implementation. Keep the API regression and both
dependency audits enabled; remove the adapter when upstream lint packages accept
the patched API directly. This development dependency is not shipped in the panel.
