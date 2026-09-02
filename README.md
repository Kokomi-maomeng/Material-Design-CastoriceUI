# CastoriceUI

![Version](https://img.shields.io/badge/version-4.0.0-6750A4)
![License](https://img.shields.io/badge/license-MIT-42664F)
![React](https://img.shields.io/badge/React-19-38618C)
![Python](https://img.shields.io/badge/Python-3.11%2B-7B5F21)

CastoriceUI 是面向 Linux VPS 的 Material Design 3 可观测控制台，用于集中查看主机资源、真实网卡流量、代理连接、网络质量、服务状态、订阅记录、告警与审计信息。

项目由 React 前端和轻量 Python/SQLite 后端组成。后端仅需接入本机数据源，浏览器不会直接访问协议管理接口，也不会用模拟数据替代不可用的生产数据。

![CastoriceUI promotional overview](public/og.png)

## 功能范围

- Linux 主机 CPU、内存、存储、负载、运行时间及网卡计数器
- 1 小时至 7 天的自适应流量趋势、跨重启统一增量账本、默认关闭或按日/周/月/年自定义的额度重置周期
- 在线连接、连接速率、来源与目标信息（以协议核心实际输出为准）
- IPv4/IPv6 网络质量探测、服务健康、告警确认及操作审计
- 首次安全初始化、应用登录、真实密码更换、会话与 CSRF 防护、界面与面板设置
- 响应式桌面与移动端布局、浅色/深色主题及减少动态效果支持

## 协议接入

| 数据源 | 当前支持 |
| --- | --- |
| Hysteria2 | Traffic Stats API 的累计流量、在线计数与活动流 |
| sing-box | AnyTLS、VLESS、XTLS Vision、Reality、SOCKS5、Shadowsocks、VMess、Trojan、TUIC |

## 本地开发

需要 Node.js 20.19+ 与 Python 3.11+：

```bash
git clone https://github.com/Kokomi-maomeng/Material-Design-CastoriceUI.git
cd Material-Design-CastoriceUI
npm ci
npm run check
npm run dev
```

`npm run dev` 会在 `https://127.0.0.1:5173` 启动仅监听回环地址的开发服务器，使用本地生成的开发证书，并把 `/api/` 代理到 `http://127.0.0.1:18080`。首次访问需在浏览器确认本地证书。后端必须另行运行在 Linux/WSL，或通过 SSH 端口转发到本机回环端口；代理目标只能通过 `CASTORICEUI_DEV_API_TARGET` 设置为 HTTP 回环 URL。Secure Cookie 不会被关闭。后端不可用或采集失败时，页面会显示明确错误且不生成演示流量。完整接口约定见 [`docs/INTEGRATION.md`](docs/INTEGRATION.md)。

## 生产部署

生产环境建议使用 systemd、Nginx 与有效 TLS。CastoriceUI 后端、Hysteria2 Traffic Stats API 和 sing-box Clash API 均应只监听回环地址，由 Nginx 同源提供网页与 `/api/`。

部署与升级步骤见 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)。升级前应备份受保护配置、完整的 `state.db*`、当前前后端目录、systemd 单元和 Nginx 站点，并保留可验证的回滚版本。

安全边界及漏洞报告方式见 [`SECURITY.md`](SECURITY.md)，贡献要求见 [`CONTRIBUTING.md`](CONTRIBUTING.md)，本次发布说明见 [`docs/RELEASE_NOTES_v4.0.0.md`](docs/RELEASE_NOTES_v4.0.0.md)。

## English

CastoriceUI is a Material Design 3 observability console for Linux VPS hosts. It combines host metrics, real interface traffic, proxy connections, network quality, service health, subscriptions, alerts, and audit records in a responsive interface.

The React frontend uses a lightweight Python/SQLite backend. Hysteria2 is integrated through its Traffic Stats API. sing-box connections are classified only through explicit inbound-tag mappings for AnyTLS, VLESS/XTLS/Reality, SOCKS5, Shadowsocks, VMess, Trojan, and TUIC.

For local development, run `npm ci`, `npm run check`, and `npm run dev`. Vite listens only on `https://127.0.0.1:5173`, creates a local development certificate, and proxies `/api/` to `http://127.0.0.1:18080`. Run the backend separately on Linux/WSL or expose a remote loopback backend through an SSH local port forward. `CASTORICEUI_DEV_API_TARGET` accepts HTTP loopback URLs only, and Secure cookies remain enabled. Keep every production backend or protocol-management endpoint on loopback behind Nginx and valid TLS.

## License

[MIT](LICENSE)
