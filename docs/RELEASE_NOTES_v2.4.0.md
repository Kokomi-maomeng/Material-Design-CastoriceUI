# CastoriceUI v2.4.0

v2.4 concentrates on chart accuracy, mobile traffic analysis, and consistent settings behavior.

## 中文

- 网络质量曲线改为按 SVG 屏幕坐标统一计算指针位置，修复缩放与不同宽度下的明显偏移。
- 设置中的布尔选项统一为无文字 Material 开关；滑块在左侧表示关闭、右侧表示开启。
- 协议分布在无流量、悬停和刷新时保持固定高度、数值字号与图例位置。
- 初始化向导优先显示已完成项目，待配置项目统一排列在下方；首次初始化的协议列表采用相同顺序。
- 流量时间桶新增 UTC 时间戳，由浏览器按本地时区显示，并始终保留最右侧最新时间标签。
- 手机端流量图保留桌面绘图区宽度，可横向滑动查看，不再压缩为难以阅读的小图。
- 底部操作提示加入 Material 风格进入与退出过渡动画。
- README、仓库简介、产品展示图、安全与部署文档以及版本标识同步更新。

## Upgrade notes

v2.4 can reuse the v2.3 protected configuration and SQLite state. Back up `state.db` with any WAL/SHM files while the service is stopped, retain the v2.3 frontend/backend directories, and deploy matching v2.4.0 assets. Validate local-time chart labels, mobile horizontal chart scrolling, settings persistence, authentication, and backend restart recovery before removing the rollback point.
