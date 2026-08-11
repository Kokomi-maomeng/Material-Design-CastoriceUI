# CastoriceUI v2.2.0

v2.2 is a reliability and release-integrity update. It is compatible with the v2.1 protected configuration and SQLite state. Keep the previous versioned frontend/backend directories and a database backup until post-restart validation succeeds.

## 中文

### 修复与改进

- 告警确认改为按告警周期保存。告警恢复时当前周期结束；同一条件再次触发时生成新周期并清除旧确认，因此不会永久静默。
- 前端只在确认接口成功写入后更新状态并显示成功提示；失败时保留未确认状态并提示重试。
- 审计日志新增受身份验证保护的 `/api/v2/audits` 接口，搜索、类别过滤、总数统计和 30/50 条分页均在 SQLite 侧完成。
- 高频 `/api/v2/dashboard` 响应不再附带最多 5000 条审计记录，降低持续带宽、序列化和浏览器解析开销。
- 发布包始终从清理后的 `dist/` 生成，构建脚本会拒绝重复逻辑资源，并输出独立的 `SHA256SUMS.txt`。
- README、安全边界、部署手册、集成接口和问题模板均同步到 v2.2。

### 升级验证

1. 备份受保护配置、SQLite 数据库及 WAL/SHM、当前前后端目录、systemd 单元与 Nginx 站点。
2. 部署同一 v2.2.0 构建中的前端和后端，不要覆盖生产配置或状态数据库。
3. 验证回环和公网 HTTPS 健康接口均报告 `2.2.0`，未登录访问仪表盘返回 401。
4. 验证登录、CSRF 写操作、审计服务端分页、告警周期单元测试、退出登录与服务重启恢复。
5. 保留 v2.1 回滚目录和备份，直到所有验证完成。

## English

### Fixes and improvements

- Alert acknowledgement is stored per alert episode. Recovery closes the episode; recurrence creates a new episode with no inherited acknowledgement.
- The UI changes acknowledgement state and shows success only after the API write succeeds. Failure leaves the alert unacknowledged and offers a retry.
- A protected `/api/v2/audits` endpoint performs search, category filtering, counting, and bounded 30/50-row pagination in SQLite.
- The frequently refreshed `/api/v2/dashboard` payload no longer carries up to 5,000 historical audit rows.
- Release archives are built from a clean `dist/`, reject duplicate logical assets, and include a separate `SHA256SUMS.txt`.
- README, security boundary, deployment, integration API, and issue-template versions now agree on v2.2.

### Upgrade verification

Back up the protected config, SQLite database with WAL/SHM, active frontend/backend, unit, and Nginx site. Deploy matching v2.2.0 frontend and backend artifacts without replacing private state. Confirm loopback and public HTTPS health, unauthenticated 401 behavior, login/CSRF/logout, audit pagination, alert-episode tests, and restart recovery before removing the v2.1 rollback point.
