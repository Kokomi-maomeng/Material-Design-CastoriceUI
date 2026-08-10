# Material-Design CastoriceUI

![Version](https://img.shields.io/badge/version-1.4.0-6750A4)
![License](https://img.shields.io/badge/license-MIT-42664F)
![React](https://img.shields.io/badge/React-19-38618C)
![Python](https://img.shields.io/badge/Python-3.11%2B-7B5F21)

一套采用 Material Design 3 的开源轻量 VPS 代理管理面板，包含响应式前端、引导式接入和可选的 Python 标准库后端。它统一呈现主机资源、Hysteria2、AnyTLS / sing-box、连接快照、流量、网络质量、证书、告警与审计信息，并明确区分实时采样、缓存结果、配置记录、缺失字段和演示数据。

A lightweight open-source Material Design 3 VPS proxy console with a responsive frontend, guided integrations, and an optional Python standard-library backend. It brings host metrics, Hysteria2, AnyTLS / sing-box, connection snapshots, traffic, network quality, certificates, alerts, and audit events together without presenting cached, missing, configured, or demo values as live evidence.

![Material-Design CastoriceUI desktop overview](docs/images/dashboard-desktop.png)

> 上图为使用文档保留地址与演示数据生成的界面预览，不代表任何真实服务器状态。
>
> The hero uses documentation-safe demo data and does not represent a live server.

[中文](#中文) · [English](#english)

## 中文

### v1.4：可信数据状态

- 首屏先显示中性加载状态，不再在真实后端响应前闪现示例服务器数字。
- 后端中断时保留最后成功快照，但明确标记“已停止更新”和快照时间，不再继续声称实时。
- Hysteria2 活动流和 sing-box 连接统一称为“活动连接条目”，不再误称独立在线设备。
- 协议核心未返回速率、来源 IP 或开始时间时显示“核心未提供”，不再使用 `0` 或当前时间补造。
- Hysteria2 / sing-box 的运行态取决于当前 API 响应；仅填写地址不再显示为已连接。
- 系统自动更新状态改为读取 `unattended-upgrades` 与 `apt-daily-upgrade.timer`，系统版本来自 `/etc/os-release`。
- 订阅记录明确属于受保护的服务器配置；HTTPS 格式校验不代表发布器可达或已验证。
- 网络探测明确标注最多缓存 5 分钟；月度流量继续明确以首个保留采样为基线。

### 主要能力

- **主机总览**：CPU、内存、磁盘、负载、运行时间、网卡速率和月度流量基线。
- **协议快照**：Hysteria2 Traffic Stats 与 sing-box Clash API；只展示协议核心实际提供的字段。
- **状态分层**：清楚区分加载中、实时快照、最后快照、预览数据、已配置和当前不可用。
- **网络与服务**：IPv4 / IPv6 延迟、抖动、丢包、systemd、证书和自动更新状态。
- **管理视图**：账号配置、活动连接条目、流量分析、订阅记录、告警和操作审计。
- **安全接入**：管理 API 默认仅监听回环地址；上游 Secret 只保存在服务器 `0640` 配置中。
- **真实验证**：Hysteria2 / sing-box 必须完成回环地址限制、连通性与鉴权检查后才可标记就绪。
- **使用体验**：桌面、平板和手机响应式布局，无障碍弹窗与键盘导航，十组主题色。
- **可回滚部署**：提供 Nginx、systemd、专用用户/组、版本化目录、备份与回滚流程。

### 后端能力

`server/` 提供不依赖第三方 Python 包的数据服务：

- `/proc`、`/sys`、`statvfs`：CPU、内存、磁盘、负载、运行时间和网卡计数器
- Hysteria2 Traffic Stats API：账号累计流量、在线计数和活动流条目
- sing-box Clash API：AnyTLS 连接、来源地址和累计流量
- `systemd` 与证书读取：核心状态、版本、运行时间和证书有效期
- IPv4 / IPv6 并发探测：延迟、抖动和丢包
- SQLite：流量采样、设置、告警确认和操作审计

管理 API 默认只监听 `127.0.0.1`，由 Nginx 通过同源 `/api/` 转发。协议 API 也应只监听回环地址，并使用独立随机密钥。浏览器不会收到上游 API Secret、配置文件、私钥或明文密码。

开源仓库、示例数据和 README 主视觉只使用文档保留地址与虚构账号。登录后的私有部署可以展示适配器实际返回的账号、来源 IP 和审计来源；如需演示环境，可设置 `redact_live_data: true`。无论该选项如何，常规仪表盘响应都不会包含完整订阅 URL、Token、上游 API Secret、配置文件、私钥或明文密码。完整订阅地址只在管理员主动复制或生成二维码时由受保护端点按需返回。

### 快速预览

需要 Node.js 20.19 或更高版本：

```bash
git clone https://github.com/Kokomi-maomeng/Material-Design-CastoriceUI.git
cd Material-Design-CastoriceUI
npm ci
npm run dev
```

打开 `http://localhost:5173`。未启动后端时会使用带有持续提示的内置示例数据；向导可以演示交互，但不会声称已经保存或验证真实配置。

### 完整检查

```bash
npm run check
```

该命令依次执行 ESLint、TypeScript、前后端测试、敏感信息扫描、生产构建和生产依赖审计。

### 生产部署

生产部署不是单条复制命令：必须先建立版本化回滚目录、专用用户与 `proxycert` 组、受限配置文件、TLS 和覆盖前端及 `/api/` 的认证。请完整执行 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)，并使用默认启用认证且指向 `current` 发布目录的 [`deploy/nginx.conf.example`](deploy/nginx.conf.example)。升级时保留现有私有配置和数据库，不要用示例文件覆盖。

### 数据准确性边界

- 网卡流量从后端首次运行时开始建立月度基线，不能恢复部署前未记录的历史采样。
- 页面每 5 秒刷新后端快照；网络 ICMP 探测最多缓存 5 分钟，二者不是同一采样频率。
- Hysteria2 可以提供账号级统计；sing-box 当前接口主要提供连接与聚合统计，能否映射到账号取决于核心返回字段。
- Hysteria2 Traffic Stats 活动流包含认证账号，但当前接口不保证返回客户端来源 IP；缺失时页面会明确显示“协议核心未提供”，不会把访问目标误标为来源地址。
- 活动流或连接条目不是独立设备计数；协议核心没有提供瞬时速率或连接开始时间时，面板不会自行推算。
- 面板不会直接执行任意 shell 命令。协议账号写入、认证迁移等高风险操作应通过经过审计的专用适配器实现。
- Basic Auth 可用于单管理员部署；多人环境建议换成带会话、CSRF 和 MFA 的认证代理。

### 项目结构

```text
app/                    Material Design 3 样式与设计令牌
components/             页面、图表、向导和 UI 组件
lib/                    类型、API 客户端、预览数据和接入定义
server/castoriceui/     Python 后端、采集器、SQLite 与 HTTP API
deploy/                 systemd 和 Nginx 示例
docs/                   部署、接入与设计文档
tests/                  前端边界测试
```

### 安全

提交前运行 `npm run check`。不要提交 `.env`、真实服务器地址、用户名、密码、订阅 Token、Cookie、API Secret、私钥或证书。示例只能使用 `example.com` / `example.test` 和文档地址。

安全问题请参阅 [`SECURITY.md`](SECURITY.md)，贡献流程见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## English

### v1.4: trustworthy data states

- Neutral loading state before the first backend response; demo metrics no longer flash during production startup
- Explicit stale-snapshot state after a backend disconnect, including the last successful timestamp
- Activity streams and connection records are no longer mislabeled as independent online devices
- Missing source IP, instantaneous rate, or start time is shown as unavailable instead of being fabricated
- Runtime adapter health is derived from current authenticated API responses, not configuration presence
- Automatic-update state comes from systemd, subscription URLs are described as configured records, and network-probe caching is disclosed

### Main capabilities

- **Host overview:** CPU, memory, disk, load, uptime, interface rates, and a retained monthly traffic baseline.
- **Protocol snapshots:** Hysteria2 Traffic Stats and sing-box Clash API data, limited to fields the cores actually return.
- **Explicit state model:** loading, live snapshot, stale snapshot, preview data, configured, and runtime-error states.
- **Network and services:** IPv4/IPv6 latency, jitter, loss, systemd, certificate, and automatic-update health.
- **Operator views:** configured accounts, activity entries, traffic, subscription records, alerts, and audit events.
- **Security boundary:** loopback-only management endpoints and server-config-only upstream Secrets.
- **Authenticated readiness:** protocol adapters become ready only after bounded connectivity and authentication probes.
- **Responsive UI:** desktop, tablet, and mobile navigation, accessible dialogs, keyboard support, and ten color themes.
- **Rollback-ready deployment:** authenticated Nginx, a dedicated systemd identity, versioned releases, backups, and rollback guidance.

### Backend

The optional backend under `server/` uses only the Python standard library and SQLite. It collects Linux resource counters, Hysteria2 Traffic Stats, sing-box Clash connection data, systemd health, certificate expiry, network probes, traffic history, alerts, and audit events.

The API listens on loopback by default and is exposed only through the authenticated same-origin `/api/` reverse proxy. Upstream secrets, raw configuration files, private keys, and plaintext passwords are never returned to the browser.

Repository examples and the README hero remain documentation-safe and explicitly labeled as demo data. A private authenticated deployment can show the account, source IP, and audit identifiers actually returned by its adapters; operators can opt into presentation masking with `redact_live_data: true`. Subscription URLs and tokens remain excluded from the dashboard payload. A protected endpoint returns a URL only for an explicit copy or QR action, and the QR value is cleared from page memory when the dialog closes.

### Development

```bash
git clone https://github.com/Kokomi-maomeng/Material-Design-CastoriceUI.git
cd Material-Design-CastoriceUI
npm ci
npm run dev
```

Open `http://localhost:5173`. Without a backend, the UI starts in clearly labeled preview mode. The workflow remains testable, but it does not claim to save or validate a real service.

Run all checks and create the production build:

```bash
npm run check
npm run build
```

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the backend, systemd, Nginx, TLS, validation, and rollback workflow. See [`docs/INTEGRATION.md`](docs/INTEGRATION.md) for the API and adapter boundary.

### Compatibility

- ES2017 browser target with clipboard, storage, and media-query fallbacks
- Locally bundled fonts and Material Symbols; no runtime font CDN
- Lazy-loaded pages and lightweight SVG charts
- Maintained Chrome, Edge, Firefox, Safari, and their mobile variants
- Python 3.11+ and a systemd-based Linux host for the optional backend

### License

[MIT](LICENSE)
