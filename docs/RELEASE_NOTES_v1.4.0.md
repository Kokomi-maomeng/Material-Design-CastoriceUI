# Material-Design CastoriceUI v1.4.0

v1.4.0 focuses on truthful live-data presentation and failure-state accuracy.

## 面向使用者的修复说明

- 修复生产首屏短暂显示示例服务器数据的问题，首次响应前仅显示中性加载状态。
- 修复后端断线后旧快照仍被标记为“实时数据”的问题；现在显示最后成功时间并明确停止更新。
- 修复把 Hysteria2 活动流条目统计为“在线设备”的误导，统一改为活动连接条目和核心报告计数。
- 修复协议核心未提供瞬时速率时显示 `0 B/s` 的误导；未知速率、来源 IP、开始时间均明确标记为未提供。
- 修复只要配置了 API 地址就显示适配器在线的问题；Hysteria2 与 sing-box 状态现在取决于当前请求结果。
- 修复 Nginx、协议服务和自动更新状态说明不准确的问题；systemd、API 适配器与系统版本分别独立采集。
- 修复订阅 HTTPS 地址格式校验被描述为发布器已验证的问题；配置记录与运行连通性现已明确区分。
- 明确网卡月度累计从首个保留样本开始，网络探测最多缓存 5 分钟，仪表盘每 5 秒刷新的是后端快照。

## Verification

- ESLint, TypeScript, frontend and backend tests
- Sensitive-content scan
- Production build and production dependency audit
- Desktop and mobile browser regression
- Authenticated VPS health and dashboard checks after a versioned, rollback-capable deployment

## Upgrade

Retain `/etc/castoriceui/config.json`, `/var/lib/castoriceui/state.db`, authentication, TLS, and upstream Secrets. Deploy frontend and backend into a new versioned release directory, switch the existing `current` and backend symlinks atomically, restart the backend, and keep the previous v1.3 release for rollback.
