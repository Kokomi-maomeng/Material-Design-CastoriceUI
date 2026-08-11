# CastoriceUI v1.5 deployment / 部署配置手册

This guide uses versioned frontend releases, a loopback backend, an authenticated TLS Nginx site, and explicit rollback points. Replace documentation domains only on the server. Never commit the resulting private configuration.

本文采用版本化前端目录、回环后端、带认证的 TLS Nginx 和明确回滚点。真实域名、Secret、订阅地址和证书路径只保存在服务器。

## 1. Requirements / 环境

- Debian 12/13 or another systemd Linux distribution
- Python 3.11+
- Nginx with a valid TLS certificate
- `apache2-utils` or another tool capable of creating an htpasswd file
- Node.js 20.19+ on the build machine
- Optional Hysteria2 Traffic Stats and sing-box Clash APIs bound to loopback

## 2. Build and frontend release / 构建与前端发布

```bash
npm ci
npm run check
npm run build
```

Create the release first, then atomically switch `current`:

```bash
release=$(date -u +%Y%m%dT%H%M%SZ)
sudo install -d "/var/www/castorice-ui/releases/$release"
sudo cp -a dist/. "/var/www/castorice-ui/releases/$release/"
sudo ln -sfn "/var/www/castorice-ui/releases/$release" /var/www/castorice-ui/current.next
sudo mv -Tf /var/www/castorice-ui/current.next /var/www/castorice-ui/current
```

The supplied Nginx example uses `root /var/www/castorice-ui/current`; keep that path aligned with this release layout.

## 3. Backend account, certificate group, and files / 后端账户与文件

The service unit expects both the dedicated account and `proxycert` group. Create them idempotently before installing the unit:

```bash
getent group proxycert >/dev/null || sudo groupadd --system proxycert
getent passwd castoriceui >/dev/null || sudo useradd --system --home-dir /var/lib/castoriceui --create-home --shell /usr/sbin/nologin castoriceui
sudo usermod -aG proxycert castoriceui
sudo install -d -m 0755 /opt/castoriceui/backend
sudo install -d -m 0750 -o root -g castoriceui /etc/castoriceui
sudo install -d -m 0750 -o castoriceui -g castoriceui /var/lib/castoriceui
sudo cp -a server/. /opt/castoriceui/backend/
```

For a first installation only:

```bash
sudo install -m 0640 -o root -g castoriceui server/config.example.json /etc/castoriceui/config.json
```

For an upgrade, back up and retain the existing `/etc/castoriceui/config.json`; never replace it with the example. Put Hysteria2 and sing-box Secrets only in this `0640 root:castoriceui` file. The browser setup form intentionally does not accept or store them.

Configure the interface, quota, certificate path, probe targets, subscriptions, and loopback API endpoints. Keep all management listeners on `127.0.0.1` or `::1`.

## 4. Protocol statistics / 协议统计

Hysteria2 server configuration:

```yaml
trafficStats:
  listen: 127.0.0.1:19090
  secret: generate-a-long-random-secret-on-the-server
```

sing-box configuration:

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

Back up and validate each protocol configuration with its own binary. Restart one service at a time and verify its authenticated loopback endpoint before configuring CastoriceUI.

## 5. systemd

```bash
sudo cp deploy/castoriceui-backend.service /etc/systemd/system/
sudo systemd-analyze verify /etc/systemd/system/castoriceui-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now castoriceui-backend
sudo systemctl status castoriceui-backend --no-pager
curl -fsS http://127.0.0.1:18080/api/v1/health
```

Expected health version for this release is `1.5.0`. The unit uses a dedicated account, `NoNewPrivileges`, read-only system protection, bounded memory, and a writable SQLite directory only.

## 6. Nginx TLS and authentication / TLS 与认证

Create a password file before enabling the site. The command prompts without placing the password in shell history:

```bash
sudo htpasswd -cB /etc/nginx/.htpasswd-castorice-ui admin
sudo chown root:www-data /etc/nginx/.htpasswd-castorice-ui
sudo chmod 0640 /etc/nginx/.htpasswd-castorice-ui
```

Copy [`deploy/nginx.conf.example`](../deploy/nginx.conf.example), then replace the documentation domain and certificate paths. Authentication is already enabled for the whole server, covering both static assets and `/api/`.

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Validate both rejection and authenticated access:

```bash
curl -I https://panel.example.com/                         # expect 401
curl -I https://panel.example.com/api/v1/health            # expect 401
curl -u admin https://panel.example.com/api/v1/health      # expect 200 and 1.5.0
curl -u admin https://panel.example.com/api/v1/dashboard   # expect mode: live
```

Do not put a password directly on a shared command line; the abbreviated examples above prompt interactively. For automation, use a protected credential source appropriate to the deployment system.

Basic Auth is suitable only for a single administrator over TLS. Multi-user deployments need an authentication proxy with secure sessions, CSRF protection, MFA, authorization, and rate limits.

## 7. Upgrade and rollback / 升级与回滚

Before an upgrade, back up:

- the current frontend release target and `current` link;
- `/opt/castoriceui/backend`;
- `/etc/castoriceui/config.json`;
- `/var/lib/castoriceui/state.db` plus its WAL/SHM files when present;
- the systemd unit and Nginx site.

After staging the new backend, run Python compilation and tests before replacing files. Restart only `castoriceui-backend`; switching static frontend files does not require an Nginx reload when its configuration is unchanged.

Rollback sequence:

1. Point `/var/www/castorice-ui/current` to the previous release.
2. Restore the previous backend directory, service unit, config, and database backup if the schema or behavior requires it.
3. Run `systemd-analyze verify` and `nginx -t`.
4. Restart `castoriceui-backend`; reload Nginx only if its configuration changed.
5. Verify loopback health, unauthenticated 401, authenticated dashboard access, and the proxy services.

## 8. Security checklist / 安全检查

- backend and protocol controllers listen on loopback only
- TLS and authentication cover both frontend and API
- Nginx root matches `/var/www/castorice-ui/current`
- `proxycert` exists and includes `castoriceui` only when certificate access requires it
- config is `0640 root:castoriceui`; state directory is `0750 castoriceui:castoriceui`
- upstream Secrets exist only in the protected server config, not SQLite or browser payloads
- invalid/non-loopback endpoints fail validation and are not persisted
- no real secrets or server addresses are present in the Git repository
- `npm run check`, CodeQL, production browser regression, and rollback checks pass before release
