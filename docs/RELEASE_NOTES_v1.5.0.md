# CastoriceUI v1.5.0

v1.5 focuses on accurate account traffic attribution, compact connection observability, and operator-controlled dashboard content.

## 修复

- 修复 Hysteria2 认证身份与面板显示名称不一致时，账号管理用量和流量分析账号排行始终为 `0`。
- 新增受保护配置中的 `trafficIdentities.hysteria2` 显式映射；单账号与单协议身份时提供无歧义自动关联，多账号歧义数据保持未归属。
- 修复旧流量小时分组可能把不同日期的同一小时合并的问题，改为按真实时间桶计算相邻网卡计数器增量。

## 连接活动

- 按协议、账号和来源 IP 聚合重复活动条目，同一来源不再占据大量表格行。
- 持续时间使用组内最早连接时间；存在真实目标时可展开查看子条目。
- Hysteria2 只展示核心实际提供的账号、请求目标、时间与累计字节；当前核心未提供来源 IP 时明确标记缺失。
- AnyTLS 展示 Clash API 实际返回的来源 IP、目标主机/IP、端口、开始时间和累计字节。
- 上传/下载速率仅通过同一连接 ID 的相邻累计字节快照计算；首个快照、计数器重置或不完整数据不显示为 `0`。

## 界面与设置

- 总览“系统资源”图替换为真实进出流量图，并增加 `1h / 6h / 24h / 3天 / 7天` 范围；流量分析同步支持这些范围。
- 协议分布与账号排行明确标注为协议核心当前累计值，不再误写为本计费周期。
- 初始化向导移出总览，成为总览下方的独立导航页面；可在设置中隐藏整个页面入口。
- 导航底部统一为“设置”及设置图标，移除单独的“显示/隐藏初始化向导”按钮。
- 设置支持自定义节点显示名称；移除总览区域副标题占位信息。
- 网络质量目标支持 `名称,地址` 或纯地址逐行配置，最多 12 个；保存时校验并清除旧缓存。
- 仅订阅管理保留“独立入口 / 快速导入 / 凭据保护”三条提示，其余页面移除重复提示栏。
- 初始化向导文案同步更新为 v1.5 的真实数据能力与限制。

## 验证

- ESLint、TypeScript、12 项项目测试、22 项后端单元测试、Python 编译、敏感内容扫描和生产构建通过。
- 生产依赖审计为 0 个已知漏洞。
- 发布部署仍要求回环管理接口、受保护 Secret、认证 TLS 反向代理、版本化目录、备份与可验证回滚点。

## Compatibility and data boundaries

- Existing protected configuration and SQLite history are preserved during upgrade.
- Multi-account Hysteria2 deployments should add explicit `trafficIdentities` mappings before relying on per-account rankings.
- Hysteria2 source IP remains unavailable when omitted by the core. AnyTLS fields are limited to the active Clash API payload.
- Calculated rates require two consecutive snapshots and are not presented as protocol-native instantaneous rates.
