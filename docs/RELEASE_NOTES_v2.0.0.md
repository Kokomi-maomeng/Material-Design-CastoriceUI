# CastoriceUI v2.0.0

v2.0 is a security, first-run, internationalization, and observability release. It removes production demo fallback, replaces browser Basic Auth with an application login, makes optional protocol mapping explicit, and expands settings without claiming unavailable data.

## 中文发布说明

### 登录与首次初始化

- 新增 Material Design 全屏登录页，显示真实登录用户名并提供可用的注销菜单。
- 使用服务器端会话、HttpOnly/SameSite Cookie、CSRF Token、自定义请求头和登录失败限速。
- 密码使用带随机盐的 scrypt 保存；会话 Token 仅以哈希形式存入 SQLite。
- 首次部署必须在服务器生成一次性 Bootstrap Token；创建管理员并保存节点名称、流量额度后才能完成初始化并进入总览。
- 注销会删除服务器会话并回到登录页；Nginx 示例移除 `auth_basic`，不再出现浏览器原生密码框。

### 界面与设置

- 全站文案支持中文、English 和跟随系统；系统语言非中英文时默认 English。
- 设置新增节点显示名、登录背景、初始化向导开关、主题及可选面板显隐。
- 登录背景支持默认样式、受限服务器图片或 HTTPS URL；后端不抓取外链，服务器图片经过路径、大小和文件签名校验。
- 初始化向导保留独立页面，首次部署时强制完成必要步骤，日常导航入口可关闭。
- 移除全部侧栏数字；通知数为零时隐藏，超过 99 时显示 `99+`；快照时间移到顶部通知旁。
- 用户菜单去除设置快捷入口，点击用户名后可正常注销。

### 流量、账号与图表

- 移除生产内置示例数据；后端不可达时显示明确错误，连接中断时只保留最后一次真实快照并标记停止更新。
- 后端定时采集网卡计数器，不依赖浏览器打开；总览和流量分析使用同一组真实 `1h / 6h / 24h / 3天 / 7天` 数据。
- 所有折线改为平滑曲线并显示更多真实采样点；无采样时不补造数据。
- 账号用量/排行继续支持 Hysteria2 `trafficIdentities` 显式身份映射，避免显示名与认证身份不同时错误归零或错归属。
- 总览与账号管理使用同一后端额度；修复额度输入时单位/控件移动和实时刷新覆盖输入的问题。

### 连接与协议

- 活动连接按协议、账号、来源 IP 聚合；显示最早连接持续时间并可展开实际子条目。
- 新增来源 IP 复制按钮；只有协议确实返回来源 IP 时可用。
- 速率只由同一连接 ID 的相邻真实累计字节快照计算，无法建立基线时隐藏。
- Hysteria2 缺少来源 IP 时继续明确标记，不把目标地址误标为来源。
- 增加 VLESS、SOCKS5、Shadowsocks 接入状态与向导，要求显式 sing-box inbound tag；未配置或鉴权探测失败时保持未配置/不可用。
- AnyTLS 与其他 sing-box 协议并存时使用明确 tag 分类，无法分类的数据保留为 `sing-box combined`，不猜测协议。

### 网络质量

- 恢复延迟、抖动、丢包三项说明栏。
- 页面内可编辑探测名称、地址和排序，最多 12 个目标；保存前执行严格地址与重复校验。
- 每次缓存探测最多采集 8 个真实 ICMP 响应点；不可达目标不写入虚构 `0 ms`。

### 安全、部署与兼容

- 上游 Hysteria2/sing-box Secret 继续只保留在服务器 `0640` 配置中；浏览器初始化向导不接收 Secret。
- 协议端点限制为回环地址、短超时、鉴权请求且禁止重定向。
- systemd 服务增加 `UMask=0077`；Nginx 更新会话登录说明、SPA 缓存和登录背景 CSP。
- 文档新增 v1.5 → v2.0 迁移、Bootstrap Token、重启恢复、数据库 WAL 备份和回滚说明。
- 验证覆盖 Chrome/Edge/Firefox/Safari 目标、桌面/平板/手机布局、浏览器缩放、键盘和触控交互。

## English release notes

### Authentication and first run

- Adds a Material Design sign-in page, actual-username menu, and working sign-out flow.
- Uses server sessions, HttpOnly/SameSite cookies, CSRF tokens, a custom mutation header, and login throttling.
- Stores salted scrypt password hashes and only hashed session identifiers in SQLite.
- Requires a server-generated one-time Bootstrap Token, first administrator, node name, and traffic quota before Overview is available.
- Removes active Nginx Basic Auth guidance so the browser credential prompt no longer replaces the application UI.

### UI and settings

- Adds full Chinese/English localization with system-language selection and English fallback.
- Adds node-name, sign-in-background, Setup visibility, theme, and optional-panel visibility settings.
- Supports default, validated server-image, and browser-fetched HTTPS login backgrounds without backend SSRF.
- Removes sidebar badges, hides zero notifications, caps at `99+`, and moves snapshot time beside notifications.

### Truthful observability

- Removes production sample-data fallback. Backend failures are explicit; stale mode retains only the last real snapshot.
- Samples host counters in the backend independently of browser refresh and provides denser real `1h / 6h / 24h / 3 day / 7 day` views.
- Uses smooth chart paths and real point markers without invented values.
- Keeps explicit Hysteria2 identity mappings for accurate account usage/rankings and shares one quota between Overview and Accounts.
- Groups connections by protocol/account/source, copies real source IPs, and exposes rates only after valid consecutive cumulative snapshots.
- Adds explicit VLESS, SOCKS5, and Shadowsocks inbound-tag mappings. Unknown sing-box traffic is not guessed.
- Adds editable ordered network targets and up to eight real ICMP replies per cached probe.

### Upgrade note

v1.5 installations retain their protected configuration and operational SQLite history, but must generate a v2.0 Bootstrap Token and create the first application administrator. Back up the database with its WAL/SHM files, deploy the backend and frontend as matching versioned artifacts, remove Nginx `auth_basic`, validate TLS/session/CSRF/logout behavior, and keep v1.5 available for rollback until restart recovery passes.
