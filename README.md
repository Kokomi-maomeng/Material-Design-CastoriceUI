# Material-Design CastoriceUI

![Version](https://img.shields.io/badge/version-2.1.0-6750A4)
![License](https://img.shields.io/badge/license-MIT-42664F)
![React](https://img.shields.io/badge/React-19-38618C)
![Python](https://img.shields.io/badge/Python-3.11%2B-7B5F21)

一套采用 Material Design 3 的轻量 VPS 流量与代理可观测面板，包含响应式前端、Python 标准库后端、应用内登录和首次初始化向导。页面只呈现主机或协议接口实际采集到的数据；后端不可用时不会回退到伪造仪表盘。

A lightweight Material Design 3 VPS traffic and proxy observability console with a responsive frontend, Python standard-library backend, application sign-in, and a protected first-run flow. The production UI displays only data collected from the host or configured protocol APIs and never falls back to a fabricated dashboard.

![Material-Design CastoriceUI desktop overview](docs/images/dashboard-desktop.png)

> 图片是使用文档保留地址与虚构账号制作的产品预览，不代表真实服务器状态。项目 README 只保留这一张横向桌面图。
> This documentation image uses reserved addresses and fictional accounts. It is not evidence of a live server.

[中文](#中文) · [English](#english)

## 中文

### v2.1 重点更新

- 新增 Material Design 登录页、HttpOnly 会话、CSRF 防护、登录限速和真实登录用户名菜单；注销后回到登录页。
- 首次部署必须使用服务器生成的一次性 Bootstrap Token 创建管理员，再完成节点名称与流量额度配置；未完成前不能进入总览。
- 全站支持中文、English 和跟随系统；系统语言不是中文或英文时使用 English。
- 设置中的初始化向导和每个可选面板均使用带“开启/关闭、显示/隐藏”状态文字的 Material 开关；滚动条、滑动控件和展开区域统一为面板风格。
- 网络探测目标可直接在页面编辑名称、地址和顺序；曲线最多使用 8 个真实 ICMP 响应点，不补造采样。
- 总览和流量分析使用后台定时保存的真实网卡计数器增量，提供 `1h / 6h / 24h / 3天 / 7天` 范围和更平滑的曲线。
- 账号额度与总览额度来自同一后端设置；Hysteria2 多账号用量需通过 `trafficIdentities` 显式映射，避免错误归属或恒为零。
- 活动连接只显示已配置且 inbound tag 匹配的协议，按协议、账号和来源 IP 聚合；详情采用与主行一致的布局，可复制来源 IP。未知标签不再显示为笼统的 sing-box。
- 协议接入覆盖常见的 Hysteria2、VLESS、Shadowsocks、VMess、Trojan、TUIC，并保留 AnyTLS 与 SOCKS5；所有 sing-box 协议都要求明确的 inbound tag。VLESS 可标记标准、XTLS Vision、Reality 或两者组合。
- 流量、占比和网络延迟图表提供即时 Material 数据浮层；审计默认 30 条，展开后每页 50 条，支持折叠页码与直接跳页。
- 通知为零时只有图标，不留下红点；提示消息重复触发也会独立计时并自动消失。右上时间更清晰，点击可显示 `YYYYMMDD` 日期。

完整修复清单见 [`docs/RELEASE_NOTES_v2.1.0.md`](docs/RELEASE_NOTES_v2.1.0.md)。

### 数据真实性边界

- 主机 CPU、内存、磁盘、负载、运行时间和网卡计数器来自 Linux `/proc`、`/sys` 与 `statvfs`。
- 流量历史从后端运行后的真实计数器相邻差值建立，无法恢复部署前未采集的历史。
- Hysteria2 Traffic Stats 可提供账号、累计流量、在线计数和活动流，但当前接口不保证提供客户端来源 IP；缺失时页面明确标记，不会把访问目标伪装成来源。
- sing-box Clash API 提供连接元数据和累计流量。AnyTLS、VLESS、SOCKS5、Shadowsocks、VMess、Trojan、TUIC 的识别只接受服务器配置中的明确 inbound tag 映射；未知标签不会显示在活动连接中。
- 连接速率由同一连接 ID 的两次真实累计字节快照计算。首次快照、计数器回退或连接 ID 不连续时不显示速率。
- ICMP 目标不可达时显示不可达/无响应，不会写入 `0 ms` 或虚构曲线点。
- 仪表盘响应不包含上游 API Secret、完整订阅 Token、私钥、配置文件或明文密码。完整订阅地址仅在管理员主动复制或生成二维码时按需返回。

### 开发检查

需要 Node.js 20.19+ 与 Python 3.11+。单独启动 Vite 但没有后端时，页面会明确报告后端不可用，不再出现预览数据。

```bash
git clone https://github.com/Kokomi-maomeng/Material-Design-CastoriceUI.git
cd Material-Design-CastoriceUI
npm ci
npm run check
npm run dev
```

`npm run check` 会执行 ESLint、TypeScript、前后端测试、Python 编译、敏感信息扫描、生产构建和生产依赖审计。

### 生产部署

生产环境需要 systemd Linux、Python 3.11+、Nginx 与有效 TLS 证书。后端和所有协议管理接口只能监听回环地址。v2.1 使用应用内登录，不要在 Nginx 增加 `auth_basic`，否则浏览器密码框会覆盖登录体验。

请完整执行 [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)，首次启动生成一次性 Token：

```bash
sudo -u castoriceui /usr/bin/python3 /opt/castoriceui/backend/run.py \
  --config /etc/castoriceui/config.json --generate-bootstrap
```

Token 文件权限必须为 `0600`，创建首个管理员后会被消费。升级时保留 `/etc/castoriceui/config.json`、`/var/lib/castoriceui/state.db*` 和以前的版本目录，绝不能用示例配置覆盖私有配置。

### 协议接入

- Hysteria2 与 sing-box 控制端点必须是 `localhost`、`127.0.0.1` 或 `::1`，并通过真实鉴权探测后才标记可用。
- Secret 只写入服务器的 `0640 root:castoriceui` 配置文件，不通过浏览器提交。
- 多账号 Hysteria2 必须在 `managed_accounts` 中配置 `trafficIdentities.hysteria2`；只有一账号和一身份时才允许无歧义自动关联。
- AnyTLS、VLESS、SOCKS5、Shadowsocks、VMess、Trojan、TUIC 共用受保护的 sing-box Clash API，并在 `protocol_adapters` 中列出各自 inbound tags；VLESS 的 `securityProfile` 只描述官方 flow/TLS 组合，不修改核心配置。

示例、限制和浏览器安全边界见 [`docs/INTEGRATION.md`](docs/INTEGRATION.md)。

## English

### v2.1 highlights

- Material Design sign-in, HttpOnly server sessions, CSRF protection, login throttling, the actual username menu, and sign-out routing.
- A protected first run: generate a one-time Bootstrap Token on the server, create the first administrator, then save the required node name and traffic quota before Overview becomes available.
- Complete Chinese/English UI with system-language selection; unsupported system languages resolve to English.
- Explicit Material switches with visible On/Off and Shown/Hidden states for Setup and every optional panel, plus consistent scrollbars, controls, and disclosure surfaces.
- Editable network probe names, addresses, and ordering, with up to eight real ICMP response points and no invented samples.
- Persisted host-interface counter sampling for smooth `1h / 6h / 24h / 3 day / 7 day` traffic views.
- One backend quota shared by Overview and Accounts; explicit Hysteria2 identity mapping prevents false account attribution.
- Active connections include only configured protocols with matching inbound tags. Unknown tags no longer appear as a generic sing-box row; expanded entries use a layout consistent with their parent.
- Common Hysteria2, VLESS, Shadowsocks, VMess, Trojan, and TUIC coverage, plus AnyTLS and SOCKS5. VLESS profiles correctly distinguish XTLS Vision flow from Reality TLS.
- Immediate Material tooltips for traffic, donut, and latency charts; 30-row audit defaults with 50-row pagination and direct page jumps.
- Zero notifications render only the icon, repeated toasts expire correctly, and the larger snapshot time opens a `YYYYMMDD` date pill.

See [`docs/RELEASE_NOTES_v2.1.0.md`](docs/RELEASE_NOTES_v2.1.0.md) for the complete public change log.

### Truthful data model

- Host metrics come from Linux `/proc`, `/sys`, and `statvfs`.
- Traffic history is built from adjacent real interface counters after the backend starts; it cannot recreate pre-install history.
- Hysteria2 may omit client source IPs. Missing source data remains explicitly unavailable and is never replaced with a destination.
- sing-box connection metadata is used as returned. Every supported sing-box protocol is classified only by explicit inbound-tag mappings; unmatched connections remain hidden instead of being guessed.
- Per-connection rates require two consecutive non-decreasing cumulative-byte snapshots for the same connection ID.
- Failed ICMP probes remain unavailable; the UI does not insert `0 ms` or fabricated points.
- Dashboard payloads exclude upstream Secrets, complete subscription tokens, private keys, raw configs, and plaintext passwords.

### Development and verification

Node.js 20.19+ and Python 3.11+ are required. A frontend without its backend displays an explicit connection error instead of sample data.

```bash
git clone https://github.com/Kokomi-maomeng/Material-Design-CastoriceUI.git
cd Material-Design-CastoriceUI
npm ci
npm run check
npm run dev
```

`npm run check` runs linting, type checking, frontend/backend tests, Python compilation, sensitive-content scanning, a production build, and a production dependency audit.

### Production

Use a systemd Linux host, Python 3.11+, Nginx, and valid TLS. Keep the backend and protocol management endpoints on loopback. v2.1 uses application authentication; do not add Nginx `auth_basic`, which would bring back the browser credential prompt.

Follow [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) from start to finish. Generate the one-time first-admin token on the server:

```bash
sudo -u castoriceui /usr/bin/python3 /opt/castoriceui/backend/run.py \
  --config /etc/castoriceui/config.json --generate-bootstrap
```

Preserve the protected config, SQLite database, and previous versioned release during upgrades. See [`docs/INTEGRATION.md`](docs/INTEGRATION.md) for adapter contracts and safety boundaries and [`SECURITY.md`](SECURITY.md) for the supported deployment boundary.

### Compatibility

- Python 3.11+ and a systemd Linux host for production
- Node.js 20.19+ for building
- Maintained Chrome, Edge, Firefox, and Safari desktop/mobile releases
- Responsive layouts for phone, tablet, desktop, browser zoom, pointer, touch, and keyboard navigation
- Locally bundled fonts and Material Symbols; no runtime font CDN

### License

[MIT](LICENSE)
