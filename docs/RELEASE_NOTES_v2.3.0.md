# CastoriceUI v2.3.0

v2.3 focuses on interaction polish and settings that behave consistently across browsers and sessions.

## 中文

- 修复流量图在左右边缘出现的鼠标定位偏移，指针坐标现在通过 SVG 屏幕变换矩阵换算。
- 设置开关移除状态文字，只保留符合 Material Design 3 的左右滑块状态。
- 时间与账号菜单支持点击外部自动关闭、Escape 关闭以及展开和收起动画。
- 页面、卡片、按钮、对话框、导航、浮层和设置抽屉加入统一的 MD3 动效，并继续遵循系统“减少动态效果”设置。
- 左上角面板标题可自定义，并作为受保护的服务端界面设置保存。
- “显示模式”“主题色彩”“面板自定义”合并到“主题风格”，主题色彩与面板列表均可折叠。
- 常规设置新增空闲自动退出，可选择不自动退出或 2、5、10、15、20、30 分钟。
- 网络质量小图使用与主流量图一致的平滑曲线、线帽和渐变面积样式。
- README、产品截图、仓库简介、部署文档、集成文档和版本标识同步更新。

## Upgrade notes

v2.3 can reuse the v2.2 protected config and SQLite state. Back up `state.db` together with any WAL/SHM files while the service is stopped, retain the previous frontend/backend directories, then deploy matching v2.3.0 assets. Verify login, inactivity logout, settings persistence, chart pointer alignment, menu dismissal, mobile layout, and backend restart recovery before removing the rollback point.
