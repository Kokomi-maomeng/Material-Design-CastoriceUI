# CastoriceUI v6.0.2

- 登录页在图片加载前即显示玻璃卡片和主题背景；图片解码、玻璃取景准备完成后一起淡入，保留已输入内容。缓存图片在退出登录的首帧继续显示，图片失败保留可用表单和背景回退。
- 玻璃高光按实际鼠标/触控笔悬停输入平滑跟随，离开、取消和窗口失焦后归位，再进入时从当前位置连续移动。触摸及减少动态效果模式采用静态柔光，兼容混合输入设备；空闲时停止动画调度。
- 侧边栏滚动区为键盘焦点外框预留四边空间，修复桌面宽侧栏、窄侧栏及较矮窗口中的裁切，保持导航项高度和滚动可达性。

本补丁只调整前端显示和交互，不更改代理核心或 Nginx 配置。保留登录背景缓存、设置、历史记录与确认值。

## English

The sign-in glass card appears immediately over a themed fallback. Decoded photos and their aligned glass imagery fade in together without replacing the form; cached images remain visible on the first sign-out paint.

The glass highlight eases toward mouse or hovering-pen input and returns to rest on exit, including hybrid devices. Touch and reduced-motion use static lighting. Navigation scrollports reserve room for complete keyboard focus outlines at expanded and compact desktop widths.
