# CastoriceUI v1.2 deployment / 部署配置手册

This guide uses a versioned release directory, a loopback backend, systemd, and Nginx. Replace all example names on the server only. Never commit the resulting private configuration.

本文采用版本目录、回环后端、systemd 与 Nginx。所有真实域名、Secret 和订阅地址只在服务器配置，禁止提交生成后的私有配置。

## 1. Requirements / 环境

- Debian 12/13 or another systemd Linux distribution
- Python 3.11+
- Nginx with TLS already configured
- Node.js 20.19+ only on the build machine
- Optional Hysteria2 Traffic Stats API and sing-box Clash API bound to loopback

## 2. Build / 构建

```bash
npm ci
npm run check
npm run build
```

Keep a rollback release before switching the symlink:

```bash
release=$(date -u +%Y%m%dT%H%M%SZ)
sudo install -d "/var/www/castorice-ui/releases/$release"
sudo cp -a dist/. "/var/www/castorice-ui/releases/$release/"
sudo ln -sfn "/var/www/castorice-ui/releases/$release" /var/www/castorice-ui/current.next
sudo mv -Tf /var/www/castorice-ui/current.next /var/www/castorice-ui/current
```

## 3. Backend user and files / 后端用户与文件

```bash
sudo useradd --system --home-dir /var/lib/castoriceui --create-home --shell /usr/sbin/nologin castoriceui
sudo install -d -m 0755 /opt/castoriceui/backend
sudo install -d -m 0750 -o root -g castoriceui /etc/castoriceui
sudo install -d -m 0750 -o castoriceui -g castoriceui /var/lib/castoriceui
sudo cp -a server/. /opt/castoriceui/backend/
sudo cp server/config.example.json /etc/castoriceui/config.json
sudo chown root:castoriceui /etc/castoriceui/config.json
sudo chmod 0640 /etc/castoriceui/config.json
```

Edit `/etc/castoriceui/config.json` and set the interface, quota, certificate path, network targets, and loopback protocol APIs. Do not use `0.0.0.0` for management APIs.

编辑配置中的网卡、额度、证书路径、探测目标和协议 API。管理接口必须监听 `127.0.0.1`，不要监听公网地址。

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

Back up both files, validate them with the protocol binary, restart one service at a time, and confirm each loopback endpoint before continuing.

## 5. systemd

```bash
sudo cp deploy/castoriceui-backend.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now castoriceui-backend
sudo systemctl status castoriceui-backend --no-pager
curl -fsS http://127.0.0.1:18080/api/v1/health
```

The unit uses `NoNewPrivileges`, read-only system protection, a dedicated user, bounded memory, and a writable SQLite directory only.

## 6. Nginx

Use [`deploy/nginx.conf.example`](../deploy/nginx.conf.example). Apply authentication to both the static site and `/api/`.

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Recommended checks:

```bash
curl -I https://panel.example.com/
curl -I https://panel.example.com/api/v1/health
curl -u admin https://panel.example.com/api/v1/dashboard
```

Expected behavior: unauthenticated requests are rejected, authenticated health returns 200, and the dashboard payload reports `mode: live` without upstream secrets.

For a private authenticated deployment, `redact_live_data: false` displays the account, source IP, and audit identity returned by the configured adapters. Set it to `true` for a shared demo or presentation environment. Neither mode includes complete subscription URLs in the dashboard response. `/api/v1/subscriptions/<id>/url` is intentionally separate: the UI calls it only after an authenticated administrator clicks copy or QR, and does not persist the result in browser storage.

## 7. Rollback / 回滚

1. Point `/var/www/castorice-ui/current` to the previous release.
2. Restore the previous Nginx site and run `nginx -t` before reload.
3. Restore protocol configurations only if their local API validation fails.
4. Disable the panel backend with `systemctl disable --now castoriceui-backend` if necessary.
5. Keep `/var/lib/castoriceui/state.db` unless you intentionally want to discard history and audit events.

## 8. Security checklist / 安全检查

- API and protocol controllers listen on loopback only
- TLS and authentication cover the frontend and API
- `/etc/castoriceui/config.json` is `0640 root:castoriceui`
- no real secrets are present in the Git repository
- private deployment uses the intended `redact_live_data` policy and never includes a subscription URL or Token in the dashboard payload
- Nginx, backend, Hysteria2, and sing-box are active
- `npm run check` and the production browser regression pass before release
