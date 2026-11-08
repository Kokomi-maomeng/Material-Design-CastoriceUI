# CastoriceUI v6.3.0

## 中文

- 网络质量最多显示五条网络告警，更多记录可直达告警中心。确认完成后，卡片保留一行提示。
- 告警中心在后台读取新增记录，两个入口的确认操作即时反馈，写入失败会恢复记录。新增告警和列表收起带有动画，并尊重系统的减少动态效果设置。
- 账号页在列标题提供账号或邮箱搜索、状态和协议筛选，以及账号名、累计流量和到期时间排序。筛选可组合，每次使用一种排序，未归属流量固定在首行。
- 流量分析的页眉更新为「连接与用量」，用量明细的悬停与按压反馈覆盖整张卡片。
- 登录语言控件采用主题配色。跟随系统时，按钮使用当前界面语言显示「语言」。

## English

- Network quality shows up to five alerts and links to the alert center for additional records. The card keeps a message after the alerts are acknowledged.
- The alert center refreshes in the background. Both acknowledgement controls respond immediately and restore records if the write fails. New rows and list collapse animate and respect reduced-motion settings.
- Account table headers provide account and email search, status and protocol filters, and sorting by name, cumulative traffic, or expiry. Filters combine with one active sort, and unattributed usage stays at the top.
- Traffic analytics uses the “Connections and usage” heading. The Usage details card shares a single hover and press state across its surface.
- The sign-in language picker uses theme colors and shows the localized language label when following the system.

See the [upgrade guide](DEPLOYMENT.md) for package verification and rollback.
