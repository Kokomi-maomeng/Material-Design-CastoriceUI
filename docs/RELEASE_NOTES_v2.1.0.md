# CastoriceUI v2.1.0

v2.1 focuses on interaction detail, truthful protocol classification, and day-to-day operability. It is a compatible upgrade from v2.0: retain the protected configuration, SQLite database (including WAL/SHM files), login backgrounds, and the previous release for rollback.

## 面向使用者的修复

- 设置中的初始化向导和每个可选面板现在使用统一的 Material 开关，并直接显示“开启/关闭”或“显示/隐藏”；面板摘要同时显示当前可见数量。
- 全局滚动条、滑动控件、展开区、列表空状态与连接详情统一为 Material Design 3 风格。
- 操作审计默认只显示最近 30 条；展开后每页 50 条，页码自动折叠为首尾页、当前页邻近页与省略号，并支持输入页码跳转。
- 通知数为零时完全隐藏红点；存在未确认告警时显示红色数字角标，最大 `99+`。
- 流量折线、占比环图和网络延迟迷你图提供即时的自定义数据提示，不再依赖浏览器延迟出现的原生 `title` 方框。
- 活动连接的协议筛选来自真实返回数据：未配置、无匹配连接或未知 inbound tag 不会出现在筛选栏和列表中。
- 展开的连接子条目改为与主行一致的分区布局，清楚区分目标、持续时间、下载和上传速率。
- 相同文案的重复提示使用独立生命周期，刷新服务状态等提示会自动消失。
- 右上快照时间增大并可点击，点击后以 Material 椭圆块显示 `YYYYMMDD` 日期。
- 登录页删除两处冗余的小字，中文和 English 同步处理。

## 协议接入

- 在现有 Hysteria2、AnyTLS、VLESS、SOCKS5、Shadowsocks 基础上加入 VMess、Trojan、TUIC 显式适配器；常见六类代理协议为 Hysteria2、VLESS、Shadowsocks、VMess、Trojan、TUIC。
- AnyTLS 也必须配置明确的 inbound tag，不再把未识别的 sing-box 连接默认归为 AnyTLS 或笼统的 `sing-box`。
- VLESS 可选择 `standard`、`xtls-vision`、`reality`、`xtls-vision-reality`。XTLS Vision 对应官方 `xtls-rprx-vision` flow，Reality 属于 TLS 配置；该字段仅用于真实标签的展示与归类，不改写核心配置。
- 所有浏览器端协议保存仍需通过带鉴权的回环 `/connections` 探测，Secret 继续只存在于服务器受限配置。

## Developer notes

- Audit retrieval now keeps up to 5,000 protected records available to the client-side pager instead of silently capping the page at 100 rows.
- Connection collector tests assert that unmatched sing-box tags are omitted and that VLESS security profiles produce the correct compound label.
- The release remains demo-free: missing metrics stay missing, connection rates still require consecutive non-decreasing counters, and no protocol is inferred from ports, destinations, or names.

## Upgrade verification

1. Build and deploy matching frontend/backend `2.1.0` artifacts.
2. Confirm loopback and public HTTPS health both report `2.1.0`.
3. Sign in with the existing v2.0 application account; no new bootstrap is required.
4. Add explicit inbound tags for AnyTLS and any newly enabled VMess, Trojan, or TUIC adapter.
5. Verify zero-alert badge behavior, repeated refresh toasts, chart inspection, audit paging, logout, and a service restart.
6. Keep the previous v2.0 release and database backup until restart recovery and public checks pass.
