# Material-Design CastoriceUI v1.3.0

v1.3.0 focuses on trustworthy first-run behavior, authenticated integration validation, reproducible deployment, and repository security.

## 修复内容

- 接入配置不再因为字段非空就显示“验证成功”。Hysteria2 与 sing-box 必须通过真实鉴权请求，失败时不会持久化或覆盖原配置。
- 管理 API 地址只接受 `localhost`、IPv4 回环或 IPv6 回环地址，拒绝公网、内网、云元数据地址、URL 内嵌凭据、查询参数和片段。
- 上游 Secret 不再从浏览器提交或存入 SQLite，只从权限为 `0640 root:castoriceui` 的服务器配置读取；启动时自动清理 v1.2 遗留的 SQLite 明文 Secret。
- 预览模式新增持续可见的“示例数据”提示；页面、服务卡片和配置向导不再把虚构数据描述为实时、正常或验证完成。
- Nginx 示例默认启用 TLS 与 Basic Auth，并与 `/var/www/castorice-ui/current` 版本目录保持一致。
- systemd 部署文档补齐 `castoriceui` 用户、`proxycert` 组、目录属主、配置权限、静态检查、备份和回滚步骤。
- README 与 `SECURITY.md` 更新为当前 React/Vite + Python/SQLite 架构，不再保留旧 vinext 告警或“纯前端”描述。
- 新增 CodeQL、Dependabot、固定 SHA 的 GitHub Actions、Issue/PR 模板和发布校验清单。
- 序列化并发仪表盘快照，避免 CPU 与网卡计数基线在多请求下竞争。
- 网络探测目标采用严格 IP/域名校验，阻止以命令行选项开头的恶意目标。

## Fixes

- Integrations become ready only after a real authenticated upstream request succeeds; failed validation is not persisted.
- Management endpoints are restricted to localhost and loopback IPs, blocking public, internal, and cloud-metadata targets.
- Upstream Secrets are server-config-only, never submitted by the browser or stored in SQLite; v1.2 legacy values are removed on startup.
- Preview mode is persistently labeled and never presents demo metrics or setup results as live or verified.
- The Nginx example enables TLS and authentication by default and uses the same versioned `current` directory documented for releases.
- systemd account/group creation, file ownership, verification, backups, and rollback are now complete and reproducible.
- Security and architecture documentation now matches the React/Vite frontend and Python/SQLite backend.
- CodeQL, Dependabot, SHA-pinned Actions, issue templates, and pull-request checks improve repository maintenance.

## Upgrade note

Back up the existing backend, `/etc/castoriceui/config.json`, SQLite database, systemd unit, Nginx site, and current frontend release. Keep upstream Secrets in the protected server config. After restart, confirm health reports `1.3.0`, invalid endpoints are rejected, unauthenticated requests return `401`, and authenticated dashboard data reports `mode: live`.
