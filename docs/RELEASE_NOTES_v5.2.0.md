# CastoriceUI v5.2.0

The alert center now focuses on actionable incidents. Alert evidence dialogs and badges are removed. Diagnostic records stay in bounded local SQLite logs, with an optional log locator for each episode.

- Distinguish confirmed outages, sustained actionable warnings, and informational collection gaps or mild fluctuations. Debounce short gaps, group duplicate observer notices and merge pending flaps without suppressing new incidents after acknowledgement.
- Combine browser-local date ranges, one lifecycle state and one severity. Click a severity summary to apply the same filter. Keep only Pending and All records as top-level scopes.
- Use the same 30-record compact view and 50-record paginated expansion for alerts and audits. Cache the first page for immediate toggling, retain rows during paging and animate transitions with reduced-motion support.
- Normalize Unix seconds/milliseconds and reject invalid epoch/uptime dates. Increase timestamp size and spacing; remove redundant explanations.
- Bound monitoring payload storage, coalesce stable protocol snapshots and archive completed acknowledged incidents in shared batches. Preserve historical records, acknowledgements and first/worst/latest local diagnostic snapshots.

See [alert and log behavior](V5.2_ALERTS.md), [monitoring operations](MONITORING.md) and [deployment/recovery](DEPLOYMENT.md). Upgrades use versioned directories and restart only the panel backend. The supported server baseline remains Debian 12/13 amd64 with systemd; other systems require separate qualification. Historical platform-cache privacy cleanup remains independently tracked.

## 中文

告警中心移除证据弹窗与卡片，保留系统内的故障记录和日志定位。按实际影响区分严重、警告和提醒，短暂缺报先观察，同类提醒合并；已确认故障再次发生仍会新建告警。

仅保留待处理和全部记录，支持日期、状态、级别组合筛选和级别卡片快捷筛选。告警与审计统一默认 30 条、展开每页 50 条；展开收起使用缓存并保留滚动位置，翻页及列表变化带动画。修正时间单位处理，放大并拉开时间显示。

日志使用共享 SQLite，限制采样容量、合并稳定采样并批量归档，不按告警或丢包创建小文件。历史记录与确认值保留。部署继续保持代理核心连续运行。
