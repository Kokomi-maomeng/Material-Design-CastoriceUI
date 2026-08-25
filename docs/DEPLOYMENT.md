# CastoriceUI v3.3 deployment / 部署手册

This guide uses versioned releases, a loopback backend, application sessions, TLS, backups, and explicit rollback points. Real domains, Secrets, subscription values, certificates, and Bootstrap Tokens belong only on the server.

本手册采用版本化目录、回环后端、应用会话、TLS、备份和明确回滚点。真实域名、Secret、订阅内容、证书和 Bootstrap Token 只能保留在服务器。

## 1. Requirements / 环境要求

- Debian 12/13 or another systemd Linux distribution
- Python 3.11+
- Nginx and a valid TLS certificate
- Node.js 20.19+ on the build machine
- Optional loopback-only Hysteria2 Traffic Stats and sing-box Clash APIs

Do not deploy the backend directly on a public address. The v3.3 login cookie is Secure by default and therefore requires HTTPS in production.

## 2. Choose an artifact and inspect it / 选择交付物并检查

From a source checkout, install the locked dependencies and build `dist/`:

从源码检出时，安装锁定依赖并构建 `dist/`：

```bash
npm ci
npm run check
npm run build
```

The GitHub Release archive is a prebuilt deployment bundle. Download both assets, verify the checksum before extracting, then use its `frontend/` directory directly; it intentionally does not contain `package.json`, `package-lock.json`, or `dist/`, so do not run `npm ci` inside the extracted bundle.

GitHub Release 压缩包是预构建部署包。请同时下载压缩包与校验文件，解压前先验证校验值，然后直接使用其中的 `frontend/`；包内有意不包含 `package.json`、`package-lock.json` 或 `dist/`，因此不要在解压目录中执行 `npm ci`。

```bash
sha256sum -c SHA256SUMS.txt
tar -xzf CastoriceUI-v3.3.0.tar.gz
cd CastoriceUI-v3.3.0
python3 -m compileall -q server
python3 -m unittest discover -s server/tests -p 'test_*.py' -v
```

Do not deploy when any applicable check fails. Review the produced `dist/` or bundled `frontend/`, the staged backend, and the sensitive-content results before copying files.

## 3. Back up before install or upgrade / 先备份

Record the current symlink targets and back up, when present:

- `/var/www/castorice-ui/current` and its release directory;
- `/opt/castoriceui/backend`;
- `/etc/castoriceui/config.json`;
- `/var/lib/castoriceui/state.db`, `state.db-wal`, and `state.db-shm`;
- the systemd unit and active Nginx site.

For a live SQLite database, stop `castoriceui-backend` briefly before copying the database files, or use SQLite's online backup API. Never copy only `state.db` while ignoring an active WAL.

## 4. Service identity and protected files / 服务账号与文件

```bash
getent group proxycert >/dev/null || sudo groupadd --system proxycert
getent passwd castoriceui >/dev/null || sudo useradd --system --home-dir /var/lib/castoriceui --create-home --shell /usr/sbin/nologin castoriceui
sudo usermod -aG proxycert castoriceui
sudo install -d -m 0755 /opt/castoriceui/backend
sudo install -d -m 0750 -o root -g castoriceui /etc/castoriceui
sudo install -d -m 0750 -o castoriceui -g castoriceui /var/lib/castoriceui
sudo install -d -m 0700 -o castoriceui -g castoriceui /var/lib/castoriceui/login-backgrounds
sudo cp -a server/. /opt/castoriceui/backend/
```

First installation only:

```bash
sudo install -m 0640 -o root -g castoriceui server/config.example.json /etc/castoriceui/config.json
```

On upgrades, merge new keys manually into the existing protected config. Never overwrite it with `config.example.json`. Set the real interface name, quota, certificate path, subscription provider, account mappings, and loopback API Secrets only on the server.

## 5. Protocol statistics / 协议统计

Hysteria2 example:

```yaml
trafficStats:
  listen: 127.0.0.1:19090
  secret: generate-a-long-random-secret-on-the-server
```

sing-box example:

```json
{
  "experimental": {
    "clash_api": {
      "external_controller": "127.0.0.1:19091",
      "secret": "generate-a-different-random-secret-on-the-server",
      "access_control_allow_origin": [],
      "access_control_allow_private_network": false
    }
  }
}
```

Validate each core with its own binary, restart one service at a time, then test its authenticated loopback endpoint. AnyTLS, VLESS, SOCKS5, Shadowsocks, VMess, Trojan, and TUIC classification additionally requires explicit inbound tags in `protocol_adapters`; see [`INTEGRATION.md`](INTEGRATION.md).

## 6. systemd and Bootstrap Token

```bash
sudo cp deploy/castoriceui-backend.service /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/castoriceui-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now castoriceui-backend
sudo systemctl status castoriceui-backend --no-pager
curl -fsS http://127.0.0.1:18080/api/v2/health
```

Expected version: `3.3.0`.

For a new database, generate the first-admin token once:

```bash
sudo -u castoriceui /usr/bin/python3 /opt/castoriceui/backend/run.py \
  --config /etc/castoriceui/config.json --generate-bootstrap
sudo stat -c '%a %U:%G %n' /var/lib/castoriceui/bootstrap-token
```

Expected mode/owner: `600 castoriceui:castoriceui`. Read it from a protected administrator terminal and enter it only on the first-run page. It is consumed after the administrator is created. Do not put it into shell history, logs, chat, screenshots, Git, or Nginx configuration. If no user exists and the token was lost, stop the service, remove only the exact token file after verifying its path, generate a new one, then restart.

## 7. Frontend release / 前端版本目录

```bash
release=v3.3.0
frontend_source=dist       # source checkout / 源码检出
# frontend_source=frontend # GitHub Release bundle / GitHub Release 预构建包
test -f "$frontend_source/index.html"
sudo install -d "/var/www/castorice-ui/releases/$release"
sudo cp -a "$frontend_source/." "/var/www/castorice-ui/releases/$release/"
sudo ln -sfn "/var/www/castorice-ui/releases/$release" /var/www/castorice-ui/current.next
sudo mv -Tf /var/www/castorice-ui/current.next /var/www/castorice-ui/current
```

The supplied Nginx example uses `root /var/www/castorice-ui/current` and SPA fallback routing.

## 8. Nginx, TLS, and application login / Nginx、TLS 与登录

Copy [`../deploy/nginx.conf.example`](../deploy/nginx.conf.example), replace only the documentation domain/certificate paths on the server, then run:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Do **not** enable `auth_basic`. v3.3 provides its own sign-in page and server-side session. Nginx Basic Auth would bring back the browser credential prompt and interfere with sign-out.

Recommended validation before using a browser:

```bash
curl -fsS http://127.0.0.1:18080/api/v2/health
curl -fsS https://panel.example.com/api/v2/health
curl -fsS https://panel.example.com/api/v2/bootstrap
curl -i https://panel.example.com/api/v2/dashboard   # expect 401 without session
curl -I https://panel.example.com/                   # expect 200, never a Basic Auth challenge
```

The public health and bootstrap-state endpoints contain no credentials. Dashboard and mutation endpoints require an authenticated session. Mutations also require the session CSRF token and `X-CastoriceUI-Request: 1`.

## 9. First browser use / 首次浏览器使用

1. Open the HTTPS panel in a private browser window.
2. Confirm the CastoriceUI sign-in/initialization page appears, not a browser password dialog.
3. Enter the one-time token, a 3-64 character username, and a password of at least 12 characters using three character classes.
4. Save the required node display name and traffic quota.
5. Configure only protocol integrations whose loopback endpoint and server Secret are already ready.
6. Complete initialization and verify Overview uses the saved name/quota.
7. Sign out and confirm the protected dashboard cannot be reopened with the old page history.

For an existing v1.5 database, v2.0 reports setup required until a v2.0 administrator is created. Existing operational history/configuration is retained; a new application user is still required because v1.5 relied on Nginx Basic Auth and had no compatible password database.

## 10. Login backgrounds / 登录背景

Server images must be PNG, JPEG, or WebP, no larger than 5 MB, and stored directly inside the configured `login_background_directory` (default: `/var/lib/castoriceui/login-backgrounds`). The settings page displays this exact directory. The backend rejects traversal, nested paths, unsupported magic bytes, and files outside the directory. Image API mode accepts a public HTTPS image, redirect, or small JSON object containing `url`, `image`, `imageUrl`, or `image_url`; it rejects credentials, fragments, private/reserved DNS results, responses over 5 MB, and non-image magic bytes. Results are served same-origin and cached for 15 minutes, so no CSP host change is required. Set `external_background_hosts` only when an explicit host allowlist is desired.

## 11. Upgrade and rollback / 升级与回滚

Upgrade sequence:

1. Back up the protected config, database/WAL, current frontend target, backend, service unit, and Nginx site.
2. Stage and test the new backend in a separate directory.
3. Stop the backend only for the final database-safe replacement window.
4. Install the new backend and unit; preserve private config and state.
5. Start the backend, verify loopback health, then switch the frontend symlink atomically.
6. Verify TLS, login/session/CSRF, dashboard truthfulness, protocol status, and logs.
7. Keep the prior release and backup until post-restart validation passes.

Rollback:

1. Restore the previous frontend symlink and backend directory.
2. Restore the matching database/config backup if the previous backend cannot read the upgraded state.
3. Restore the previous unit/Nginx file when changed.
4. Run `systemd-analyze verify` and `nginx -t`.
5. Restart the backend, reload Nginx only if its config changed, and repeat health/auth/protocol checks.

## 12. Restart recovery and release checklist / 重启恢复与发布检查

If this VPS also carries the operator's active proxy traffic, do not reboot the host merely to prove recovery. First establish an independent management path or provider console, verify the proxy services are enabled, stage an automatic rollback, and monitor the proxy from outside the VPS. Otherwise restart only `castoriceui-backend`; CastoriceUI deployment must not restart Hysteria2 or sing-box.

- `systemctl is-enabled castoriceui-backend` returns `enabled`
- `systemctl restart castoriceui-backend` returns to `active`
- loopback and HTTPS health report `3.3.0`
- `/api/v2/dashboard` rejects an unauthenticated request
- the application login works and logout invalidates the session
- first-run setup is required only when appropriate
- config is `0640 root:castoriceui`; state/background directories are restricted
- backend, Hysteria2, and sing-box controllers listen on loopback only
- dashboard, Accounts, and Traffic use consistent real values
- unavailable protocol/source/rate fields remain unavailable instead of zero/fabricated
- Nginx root resolves to the intended versioned release
- `npm run check`, CodeQL, responsive/browser checks, sensitive scan, backup, and rollback review pass
