# CastoriceUI v4.6.0

## 中文

- 移除收起桌面侧边栏后露出的移动导航遮罩空按钮。
- 所有页面持续保留右侧滚动条和宽度；设置、额度和初始化向导弹窗打开关闭时保持页面位置。弹窗内部滚动条保持可见，覆盖嵌套弹窗与下拉选项。
- 调整初始化向导“接入前检查”卡片的上下内边距、文字间距和移动端布局。
- 操作审计按用户浏览器的本地时区显示完整日期和时间，并标明时区；告警使用相同时间格式。
- 告警全部记录与操作审计共用展开和分页控件：默认最近 30 条，展开后每页 50 条，支持上一页、下一页、页码和跳页。
- 告警恢复后仍保留在待处理和通知数量中，直到手动确认。每次异常有独立事件身份，确认旧事件不会误确认后来发生的异常。全部确认覆盖所有待处理页面。
- 全部告警历史持久保存，分页读取不受仪表盘 200 条缓存限制；操作审计原有保留周期继续适用。

## English

- Hide the mobile navigation scrim button on desktop, including when the sidebar is collapsed.
- Preserve the viewport scrollbar and page geometry across pages, settings, quota dialogs, setup wizards and nested dialogs. Keep internal dialog scrollbars visible while locking background interaction.
- Balance the setup prerequisites card padding and text spacing on desktop and mobile.
- Display audit and alert timestamps in the browser's local time zone, with an explicit time zone label.
- Share the audit history controls with alerts: latest 30 by default, 50 per expanded page, previous/next, page numbers, and direct page jumps.
- Keep recovered alerts pending and counted until manual acknowledgement. Acknowledge individual episodes so a previous recovery cannot acknowledge a new recurrence. Bulk acknowledgement covers every pending page.
- Retain all alert episodes in SQLite and paginate the complete history independently of the bounded dashboard cache. Audit log retention is unchanged.

Upgrading only requires the panel release. Hysteria2 and sing-box do not require a restart.
