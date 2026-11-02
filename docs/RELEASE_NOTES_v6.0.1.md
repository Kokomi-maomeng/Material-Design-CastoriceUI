# CastoriceUI v6.0.1

- 在线连接筛选增加来源/目标 IP、目标域名及目标端口；IP 与域名支持关键词或精确匹配，组合条件匹配同一目标。
- 实时目标默认收起，移除开启时短暂闪现的读取提示。已关闭目标继续保留 30 秒，持续时间替换为移除倒计时；读取失败保留上次记录，重新出现的连接恢复实时状态。
- 网络告警使用与告警中心一致的蓝色“项提醒”，显示发生、恢复时间及状态。增加共享“全部确认”，已确认记录同步隐藏并更新数量。
- 告警中心直接展示描述与有效时间，移除记录详情折叠、泛化监测来源及发生次数。
- 优化连接筛选与目标区、账号筛选、网络目标筛选、记录增减和空状态过渡；保留共享弹窗、选择器、设置、图表与页面动画，支持快速反转、键盘及减少动态效果。

此补丁不改动代理核心或 Nginx 配置。升级采用版本目录和事务备份，保留设置、历史与确认记录。

## English

Connection filters now support source/destination IPs, destination domains and ports, with keyword or exact address matching. Live destinations start collapsed. Closed flows remain visible for 30 seconds with a removal countdown, while failed reads preserve the last records.

Network reminders share acknowledgment state with the alert center and show occurrence/recovery times. Alert records display meaningful information directly. Filtering, disclosures, record changes and empty states use consistent motion with reduced-motion support.
