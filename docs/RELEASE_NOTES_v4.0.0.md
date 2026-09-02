# CastoriceUI v4.0.0

## 中文

- 修复深海青、冰川青、群青蓝、珊瑚橙、岩灰蓝在深色模式下的配色角色，提升侧边栏、按钮、选中状态与图标的对比度。
- 清理总览、服务状态、流量分析与操作审计中的重复提示及空容器；月流量标题改为“近期月流量”，保留原有自然月统计口径。
- 设置底部直接展示关于信息，标题和图标左对齐、元数据右对齐，项目主页按钮置于版本下方。设置仍可滚动，滚动条隐藏。
- 总流量额度弹窗叠加在设置之上，保留设置的滚动位置与未保存内容；关闭顶层弹窗后恢复焦点，底层弹窗不响应顶层的 Escape。
- 统一额度、日期、计费周期和时间控件的尺寸与列宽，修复日期图标被拉伸的问题。
- 主机信息移至服务状态顶部；存储与后端并入服务网格，位于 TLS 证书之后。服务状态与网络质量采用有上下限的响应式字号。
- 网络目标的延迟、抖动、丢包显示在曲线左侧，小屏幕使用纵向布局；图表随可用宽度绘制。
- 总览服务健康度复用服务卡片，完整展示已配置组件与存储状态。正常服务显示绿色“运行中”，问题显示红色“异常”；存储状态由数据库可写性、分区使用率和已配置适配器状态共同判断。

## English

- Corrected dark-theme foreground and container colors for Teal, Cyan, Indigo, Coral, and Slate, improving navigation, button, selection, and icon contrast.
- Removed redundant overview, service, traffic, and audit hints and empty containers. Renamed the monthly chart to “Recent monthly traffic” without changing calendar-month accounting.
- Made About permanently visible at the bottom of Settings, aligned metadata to the right, and placed the centered project link after the version. Settings remains scrollable with hidden scrollbars.
- Kept Settings open behind the quota dialog, with top-dialog keyboard handling, scroll locking, and focus restoration. Standardized schedule fields and corrected date-icon alignment.
- Moved host information above the service grid and placed storage after TLS. Improved service and network typography with bounded responsive sizes.
- Placed latency, jitter, and loss beside each network chart on wider screens and stacked them on smaller screens.
- Reused the service-card layout in Overview, including all configured services and storage. Health colors reflect runtime state, database writability, disk usage, and configured adapter health.

## Deployment

Frontend and backend versions are both `4.0.0`. Existing configuration, traffic history, quota schedules, and credentials are preserved. Follow [the deployment guide](DEPLOYMENT.md) for versioned backups, atomic switching, and rollback. Updating the panel does not require restarting Hysteria2, sing-box, or the host.
