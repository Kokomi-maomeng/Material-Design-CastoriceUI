# CastoriceUI deployment and recovery

Supported server baseline: Debian 12/13, Python 3.11+, Nginx with TLS, systemd, `iproute2`, `iputils-ping`, and safe YAML parsing. Frontend builds need Node 20.19+; installed release packages do not need Node. This is a single-host panel; it does not install proxy cores or provision proxy accounts.

服务器基线为 Debian 12/13、Python 3.11+、Nginx/TLS、systemd、`iproute2`、`iputils-ping` 和安全 YAML 解析器。发布包在服务器运行时不需要 Node。面板向导只配置和核验已存在的数据源，不安装代理核心、不生成上游密钥、不创建代理账号。

## Choose the route

| Route | Prerequisites | Core changes |
| --- | --- | --- |
| Minimal panel | Complete steps 1–4 below, then install and initialize | None; optional protocols stay unconfigured |
| Existing proxy host | Same panel prerequisites; register actual loopback API endpoints/secrets, units and inbound tags in protected config | The panel installer never restarts or reconfigures cores |
| Upgrade | Existing healthy panel, known live unit/config/database/site, verified archive and rollback media | Only the panel backend restarts; Nginx reloads only if its site configuration changes |

新主机按下面顺序执行，已有代理主机在相同前提下配置真实回环 API；升级走第 5 节。不要在服务账号、受保护配置和已启用 TLS 站点准备好之前运行安装器。

## 1. Obtain and verify the release

Download `CastoriceUI-v5.3.2.tar.gz` and `SHA256SUMS.txt` from the same [release](https://github.com/Kokomi-maomeng/Material-Design-CastoriceUI/releases/tag/v5.3.2), then run `sha256sum -c SHA256SUMS.txt`. Inspect the checksum result before extraction.

```sh
tar -xzf CastoriceUI-v5.3.2.tar.gz
cd CastoriceUI-v5.3.2
```

A source checkout uses an isolated environment. Debian marks its system Python as externally managed; keep pip installation inside the environment ([Debian guidance](https://wiki.debian.org/Python)).

```sh
sudo apt-get install -y python3-venv
python3 -m venv ../.castoriceui-venv
node scripts/python-run.mjs -m pip install -r server/requirements.txt
npm ci
npm run check
npm run release:package
```

On Windows PowerShell use `python -m venv ../.castoriceui-venv` and omit apt. The Node runner selects the project interpreter without activation or system PATH changes. Windows timezone data is installed from [python/tzdata](https://github.com/python/tzdata). The package includes the built frontend, backend, tests, templates and installer. Never include protected config, bootstrap tokens, databases or personal subscriptions in a public release.

## 2. Prepare packages, identity and writable directories

```sh
sudo apt-get update
sudo apt-get install -y python3 python3-yaml nginx openssl iproute2 iputils-ping
sudo groupadd --system -f proxycert
getent passwd castoriceui >/dev/null || sudo useradd --system --user-group --home-dir /var/lib/castoriceui --shell /usr/sbin/nologin castoriceui
sudo usermod -a -G proxycert castoriceui
sudo install -d -m 0750 -o root -g castoriceui /etc/castoriceui
sudo install -d -m 0700 -o castoriceui -g castoriceui /var/lib/castoriceui
sudo install -d -m 0700 -o castoriceui -g castoriceui /var/lib/castoriceui/login-backgrounds
sudo install -d -m 0755 /opt/castoriceui/releases /var/www/castorice-ui/releases
sudo install -m 0640 -o root -g castoriceui server/config.example.json /etc/castoriceui/config.json
```

The Debian package supplies a supported PyYAML 6.x parser. Isolated source development can use the pinned `server/requirements.txt`. Install the parser before preflight; the installer does not change system packages.

The protected config must stay under `/etc/castoriceui`. Database, bootstrap and image state must stay under `/var/lib/castoriceui`; paths outside this layout are rejected before switching. Root owns immutable release code. Do not run the backend as root or make the source tree service-writable.

## 3. Edit protected configuration

Edit `/etc/castoriceui/config.json` as root. Keep `secure_cookies: true` and a loopback `listen_host`. Defaults are `127.0.0.1:18080`; other loopback IPs/ports and protected config filenames are supported consistently by the service, Nginx upstream and health checks. Changing an upgrade's live database path is rejected to prevent silently losing state.

For a minimal panel, keep optional core API URLs, managed accounts and subscriptions empty. For an existing host, use the actual API URLs, separate random secrets, `hysteria_unit`, `singbox_unit`, binaries, `protocol_status_path`, protocol adapters and identity mappings. Management APIs must remain loopback-only. Store real subscription URLs and credentials only in this protected file; never put them in commands, issues, screenshots or Git.

Set `certificate_path`, `certificate_host`, `certificate_port` and `certificate_renewal_unit` only when the intended evidence exists. Host traffic is an interface ledger; account traffic is an explicitly mapped protocol counter and may reset with the core. Neither is a cloud-provider billing API. See [integration contracts](INTEGRATION.md).

## 4. Prepare and enable the TLS site

Obtain a certificate for your panel domain. Generate a site using one port parameter, so TLS listeners, HTTP redirect and public URL agree. If an existing core occupies TCP/443:

```sh
sudo python3 deploy/configure-site.py --config /etc/castoriceui/config.json \
  --host panel.example.com --port 2087 \
  --certificate /etc/letsencrypt/live/panel.example.com/fullchain.pem \
  --key /etc/letsencrypt/live/panel.example.com/privkey.pem \
  --output /etc/nginx/sites-available/castoriceui
```

Use your actual domain and certificate files locally. The generator refuses overwrites and never enables a site or reloads Nginx. Review the file, link it in `sites-enabled`, and use `https://panel.example.com:2087`. If another site owns HTTP/80, add `--no-http-redirect` and use the HTTPS URL directly. Manually edited sites must update both TLS listeners and HTTP redirect consistently. Verify certificate renewal separately.

Give the backend read access to only the intended certificate evidence, for example a root-owned copy of the public leaf certificate under `/etc/castoriceui/tls` with a narrowly scoped renewal hook. Do not broadly change existing proxy key permissions. Nginx certificate access and panel certificate evidence are separate checks.

Install the edited site into `/etc/nginx/sites-available/castoriceui`, link it in `sites-enabled`, and make its root `/var/www/castorice-ui/current`. The site must contain exactly one loopback API upstream. The frontend link will be created by the installer; until then static requests can return 404. Do not replace unrelated sites.

```sh
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
sudo python3 server/preflight.py --config /etc/castoriceui/config.json
```

Preflight is read-only. It checks actual loaded/active required units, optional unconfigured cores, Python/parser availability, service-account permissions, data layout, certificate file, listener ownership and the enabled site. Every `fail` must be corrected before installing; review each warning in the recorded report. Preflight checks the panel's own TLS server, certificate and exact configured loopback API upstream. After installation, add `--public-url https://panel.example.com:2087` to verify real public TLS, static HTML, health and unauthenticated API rejection. A local configuration check alone does not prove DNS/firewall reachability.

## 5. Install or upgrade

Before upgrading, record public/loopback health, enabled/active units, live symlink targets and HY2/sing-box/Nginx PIDs. Verify config and SQLite rollback media. The database backup uses SQLite's online backup API rather than copying a live `state.db` independently of WAL/SHM.

```sh
sudo sh deploy/install-or-upgrade.sh --archive /absolute/path/CastoriceUI-v5.3.2.tar.gz --config /etc/castoriceui/config.json
```

The installer validates the archive, runs staged backend regressions and preflight, records config/units/site/links and a consistent SQLite backup, then installs into paired unique release directories. It atomically replaces each frontend/backend link. These are separate filesystem operations, so a brief panel-only mismatch can occur during the switch. It restarts only `castoriceui-backend`; proxy-core continuity is checked through PIDs. The probe timer is installed/enabled and runs a read-only inventory probe. Its custom unit/output settings are read from `/etc/castoriceui/protocol-probe.env`; start with [`protocol-probe.env.example`](../deploy/protocol-probe.env.example) when needed.

A fresh backend is enabled for boot. An upgrade preserves the existing backend enable policy; an intentionally disabled service stays disabled. The upgrade starts the panel for acceptance but does not promise it will start after reboot if the operator intentionally disabled it.

Failure produces a retained `/var/backups/castoriceui-v5.3.2-*` transaction record. The record distinguishes failure before switching, verified rollback and rollback failure. The installer restores recorded links, unit/enable state and the backed-up database, verifies old health and `nginx -t`, and reports any recovery errors explicitly. Failed release directories receive a `.failed` suffix and are retained; a same-version retry gets a new unique directory. Do not manually delete rollback media before reviewing the transaction.

## 6. Bootstrap and complete first use

```sh
sudo -u castoriceui python3 /opt/castoriceui/current/server/run.py --config /etc/castoriceui/config.json --generate-bootstrap
```

Use the one-time token on the HTTPS login page to create the administrator. Save node name and traffic quota, then complete initialization. The token is consumed and initialization cannot be repeated once a user exists. The setup-complete state and canonical quota persist through backend restart. Optional unconfigured adapters remain visibly unconfigured.

CPU, memory and traffic history accumulate from real samples. Fresh installations have no previous-day history. Missing samples are reported as gaps rather than estimated traffic. Collector timestamps and TTLs indicate stale evidence independently of when an HTTP response was generated. Background dashboard polling does not renew the administrator's idle session; actual user activity is reported separately.

## 7. Accept the deployment

Login image recovery uses decoded `blob:` object URLs. The v5.0 template permits them only in `img-src`; the transactional installer extends existing explicit image directives in quoted CSP headers and reloads Nginx only when its site changes. Custom CSP configurations must permit these local image URLs. Script sources remain restricted and `unsafe-eval` is not required. Check the actual HTTPS page and image after upgrading, since development rendering alone does not validate production CSP.

- Read the expected version from the release `VERSION` file; loopback/public health must report `status: ok` and that same version. Check static frontend HTTP 200, unauthenticated dashboard/session HTTP 401, login/logout/CSRF, settings persistence and audit records.
- Check live and backup SQLite `PRAGMA integrity_check`, writable storage, fresh collector times, historical coverage, alerts and recovery. Confirm missing probe targets do not produce an overall excellent grade.
- Check Nginx syntax, required units enabled/active, failed units and recent backend logs. Compare HY2/sing-box/Nginx PIDs to the recorded baseline.
- Test desktop/mobile, both languages/themes, keyboard interactions and malformed/slow API responses. A browser-engine matrix does not substitute for physical Safari/iOS or minimum-version acceptance.
- Test boot recovery only on an independent test VM, or during an expressly planned production maintenance window. Do not reboot a live proxy host simply to complete panel acceptance.

## 8. Recover and retain evidence

If automatic recovery fails, use the retained `transaction.json`, previous-target files, unit copies, `config.json`, `nginx-site.conf`, consistent `state.db`, staged test log and preflight report. Stop only the panel backend before database restoration. Restore a complete compatible backend/frontend/config/database/unit/site set, reload systemd, restore enable state, validate Nginx and old health, and compare proxy PIDs. Use the SQLite backup API to restore rather than ignoring WAL/SHM or writing into an actively served database.

Retain the prior release, checksums and rollback directory until acceptance is complete. This panel does not automatically repair operating-system networking, firewall rules, proxy services or external certificates.

## HTML upgrade validation

Deterministic archives normalize file times. Nginx default ETags use timestamp and size, which can collide across different HTML builds. The installer applies `etag off`, `if_modified_since off` and `Cache-Control: no-store` to the HTML fallback location. Hashed assets retain immutable caching. Verify an ordinary existing-browser reload and requests carrying the old ETag or Last-Modified value: each must return the current HTML with HTTP 200. A successful health API response alone does not verify the frontend version.


## Installer coordination and custom units

The root-owned `/run/lock/castoriceui-install.lock` covers baseline capture, staging, switching, acceptance and rollback. A competing process exits without entering the transaction. Interrupted processes release the kernel lock; review their transaction record before retrying. A unique staging link avoids sharing `current.next`.

`hysteria_unit`, `singbox_unit` and `nginx_unit` supply continuity checks and the Nginx reload target. Configured loaded core units receive read-only lifecycle hooks for their next natural start. The event helper accepts only units in root-protected `/etc/castoriceui/core-event-units.json`. Do not restart cores just to populate evidence.

## Alert retention and local recovery

Maintenance commands require local root authorization, then drop to the backend's service identity before accessing state. A restore archive and its checksum must be readable by `castoriceui`; preserve that ownership and access when moving them to protected offline storage.

Defaults retain 180 days of online recovered/acknowledged episodes, with a soft online limit of 10,000. Configure `alert_retention_days` (7–3650) and `alert_history_limit` (100–100000) in protected config. Hourly maintenance waits for at least 100 eligible episodes before writing a shared batch of private `alert-archives/*.json.gz` and checksum files, verifies the complete content, then removes only the eligible online copies in a database transaction. Active or unacknowledged episodes are never silently removed. First/worst/latest diagnostic records are retained in the archive. Manual archive maintenance may export a smaller batch explicitly.

```sh
sudo python3 /opt/castoriceui/current/server/maintenance.py --config /etc/castoriceui/config.json status
sudo python3 /opt/castoriceui/current/server/maintenance.py --config /etc/castoriceui/config.json archive-alerts
sudo python3 /opt/castoriceui/current/server/maintenance.py --config /etc/castoriceui/config.json restore-alerts --archive /protected/offline/alerts-example.json.gz
sudo python3 /opt/castoriceui/current/server/maintenance.py --config /etc/castoriceui/config.json unlock-login
```

The archive and adjacent `.sha256` file must travel together. They contain private operational data and must never reach GitHub. Move verified archives to protected off-volume storage; the online soft limit cannot bound total archive disk space or delete protected episodes. Restoring archives increases online history and can make those eligible records subject to later archival again. Storage pressure produces an alert rather than deleting unconfirmed evidence.

For external observers, map duties explicitly, for example `"external_probe_protocols": {"agent-anytls": ["anytls"], "agent-hy2": ["hysteria2"]}` with matching `external_probe_agents`. Existing dual-protocol installations retain their default contract. Missing an assigned protocol is unavailable evidence; an unassigned protocol is not an outage.

The [support matrix](SUPPORT_MATRIX.md) separates qualified systems, functional dependencies and remaining hardware/browser acceptance.
