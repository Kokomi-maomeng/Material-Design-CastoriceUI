# CastoriceUI v6.4.0

## 中文

- 流量分析顶部显示近 24 小时用量、本月网卡已测用量、总上传（TX）和总下载（RX）。实时速率汇总覆盖全部连接，筛选只影响列表。
- 实时连接与用量明细共用折叠样式。展开后可以按协议、地址和端口筛选，每个连接组右侧可直接展开自己的明细。
- 连接组统一显示协议、来源 IP、连接条目数和速率。轮询就地更新数据，保留已展开的行及其顺序。确认关闭的条目保留 30 秒。
- 账号表头使用固定列宽和窄屏换行。筛选、排序和结果行使用主题动画，支持系统的减少动态效果设置。空结果保留表头和未归属流量的位置。
- 在网络质量页按 Esc 关闭指标说明后，指针停在原位时浮层保持关闭。

## English

- Traffic analytics shows 24-hour usage, measured interface usage for the current calendar month, and total TX and RX rates. Filters affect the list while totals cover all listed connections.
- Live connections shares the Usage details disclosure and offers protocol, address, and port filters when expanded. Each connection group opens its own details from its row.
- Connection groups consistently show protocol, source IP, connection count, and rates. Polling updates rows in place. Confirmed closed flows stay visible for 30 seconds.
- Account headers keep their positions when filters return no matches. Filters, sort controls, and result rows animate and respect reduced motion.
- Network metric help stays closed after Escape while the pointer remains still.

See the [upgrade guide](DEPLOYMENT.md) for package verification and rollback.
