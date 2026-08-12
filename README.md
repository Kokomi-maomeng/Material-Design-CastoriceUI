# CastoriceUI

![Version](https://img.shields.io/badge/version-2.3.0-6750A4)
![License](https://img.shields.io/badge/license-MIT-42664F)
![React](https://img.shields.io/badge/React-19-38618C)
![Python](https://img.shields.io/badge/Python-3.11%2B-7B5F21)

一个给小型 VPS 用的 Material Design 3 可观测面板。我最初只是想把主机状态、代理流量、在线连接和网络探测放在一个干净的页面里，后来逐渐补齐了应用登录、首次初始化、告警、审计和多协议适配。

前端使用 React，后端是轻量的 Python/SQLite 服务。它可以读取 Linux 主机指标，并通过本机 API 接入 Hysteria2 与 sing-box。sing-box 侧支持按 inbound tag 映射 AnyTLS、VLESS、SOCKS5、Shadowsocks、VMess、Trojan 和 TUIC；没有明确映射的连接不会被猜测或误报。

![CastoriceUI desktop overview](docs/images/dashboard-desktop.png)

> 截图使用保留地址和虚构账号制作，不包含生产数据。

[中文](#使用) · [English](#english)

## 使用

开发环境需要 Node.js 20.19+ 和 Python 3.11+：

```bash
git clone https://github.com/Kokomi-maomeng/Material-Design-CastoriceUI.git
cd Material-Design-CastoriceUI
npm ci
npm run check
npm run dev
```

前端不会用示例数据假装后端在线。只启动 Vite 时会直接显示连接错误；接上后端后，流量历史才会从真实网卡计数器逐步建立。

生产部署请阅读 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。推荐使用 systemd、Nginx 和有效 TLS，后端及协议控制 API 必须只监听回环地址。首次部署需要在服务器生成一次性 Bootstrap Token，用它创建管理员：

```bash
sudo -u castoriceui /usr/bin/python3 /opt/castoriceui/backend/run.py \
  --config /etc/castoriceui/config.json --generate-bootstrap
```

升级时保留私有配置、`state.db*` 和上一个版本目录。不要用仓库里的示例配置覆盖生产配置，也不要在 Nginx 额外开启 `auth_basic`。

## 数据从哪里来

- CPU、内存、磁盘、负载、运行时间和网卡计数器来自 Linux `/proc`、`/sys` 与 `statvfs`。
- Hysteria2 Traffic Stats API 提供账号流量、在线数和活动流；接口缺少来源 IP 时，页面会明确留空。
- sing-box Clash API 提供连接与流量数据，协议身份只按服务器配置的 inbound tags 判断。
- 网络质量来自小流量 ICMP 探测。不可达目标不会被写成 `0 ms`，曲线也不会补造采样点。
- 密钥、完整订阅地址、私钥和明文密码不会进入普通仪表盘响应。

接入配置和字段限制见 [`docs/INTEGRATION.md`](docs/INTEGRATION.md)，安全边界见 [`SECURITY.md`](SECURITY.md)。v2.3 的发布说明在 [`docs/RELEASE_NOTES_v2.3.0.md`](docs/RELEASE_NOTES_v2.3.0.md)。

## English

CastoriceUI is a small Material Design 3 dashboard for VPS observability. It brings host metrics, proxy traffic, active connections, network probes, alerts, and audit history into one interface without pretending unavailable data exists.

The React frontend talks to a lightweight Python/SQLite backend. Hysteria2 uses its Traffic Stats API; sing-box protocols are mapped through explicit inbound tags, including AnyTLS, VLESS, SOCKS5, Shadowsocks, VMess, Trojan, and TUIC.

To work on it locally:

```bash
git clone https://github.com/Kokomi-maomeng/Material-Design-CastoriceUI.git
cd Material-Design-CastoriceUI
npm ci
npm run check
npm run dev
```

For production, use a systemd Linux host, Nginx, and TLS. Keep the backend and every protocol control endpoint on loopback. Follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md), and preserve the protected config, SQLite state, and previous release when upgrading.

Adapter details live in [`docs/INTEGRATION.md`](docs/INTEGRATION.md). See [`docs/RELEASE_NOTES_v2.3.0.md`](docs/RELEASE_NOTES_v2.3.0.md) for this release.

## License

[MIT](LICENSE)
