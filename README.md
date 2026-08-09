# Material-Design CastoriceUI

![License](https://img.shields.io/badge/license-MIT-6750A4)
![Node](https://img.shields.io/badge/Node.js-%E2%89%A520.19-42664F)
![React](https://img.shields.io/badge/React-19-38618C)

一个采用 Material Design 3 的响应式 VPS 代理管理前端，也是一套便于二次开发的纯静态界面基础。项目不捆绑代理内核、数据库或特权系统服务；所有演示数据均为虚构内容。

A responsive Material Design 3 frontend for VPS proxy management and a clean foundation for custom integrations. It ships as static files and does not bundle a proxy core, database, authentication server, or privileged system agent. All included data is fictional.

![CastoriceUI desktop overview](docs/images/dashboard-desktop.png)

<p align="center">
  <img src="docs/images/dashboard-mobile.png" width="320" alt="CastoriceUI mobile subscription view">
</p>

[中文](#中文说明) · [English](#english)

## 中文说明

### 功能

- 总览：流量额度、预计耗尽日期、CPU、内存、磁盘与系统负载
- 账号管理：创建、筛选、启用/禁用、额度、到期时间与重置密码交互
- 在线连接：协议、账号、来源 IP、连接数、实时速率与持续时间
- 流量分析：今日/月度、账号排行、协议分布与小时/天趋势
- 订阅管理：独立地址、Token 重置、一键复制与二维码
- 网络质量：IPv4/IPv6 延迟、抖动、丢包与趋势
- 服务状态、告警中心与操作审计
- 浅色、深色、跟随系统及五组主题色
- 桌面、平板、手机自适应导航

### 快速开始

需要 Node.js 20.19 或更高版本。

```bash
git clone <your-repository-url>
cd Material-Design-CastoriceUI
npm ci
npm run dev
```

打开 `http://localhost:5173`。开发时通常只需要修改 `components/`、`lib/` 和 `app/globals.css`。

完整检查与生产构建：

```bash
npm run check
```

构建结果位于 `dist/`，可直接上传到任何静态 Web 服务器：

```bash
npm run build
```

### 部署

CastoriceUI 使用 Hash 路由，因此不需要服务器重写规则。将 `dist/` 作为站点根目录即可。Nginx 最小配置示例见 [`deploy/nginx.conf.example`](deploy/nginx.conf.example)。

```nginx
server {
    listen 80;
    server_name panel.example.com;
    root /var/www/castorice-ui;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

TLS、登录认证、限流和安全响应头应在反向代理或后端完成，不要把密码、API Token 或证书放入前端仓库。

### 接入真实后端

浏览器安全的数据模型位于 `lib/types.ts`，统一适配器接口位于 `lib/data-provider.ts`。生产后端可聚合 Hysteria2、AnyTLS、sing-box、系统指标和数据库数据，再返回经过鉴权、授权和脱敏的模型。

浏览器不得直接访问代理内核管理端口、Docker Socket、systemd 或数据库。详细端点建议与安全边界见 [`docs/INTEGRATION.md`](docs/INTEGRATION.md)。

### 浏览器与性能

- 构建目标为 ES2017，并提供剪贴板、主题存储和媒体查询兼容回退
- 弹窗不依赖浏览器原生 `<dialog>`，兼容较旧的 Safari 和嵌入式 WebView
- 字体与图标随项目本地打包，不依赖 Google Fonts CDN
- 页面按需加载，图表使用轻量 SVG，不引入大型图表或 UI 框架
- 建议使用仍受维护的 Chrome、Edge、Firefox、Safari 或其移动版本；不支持 Internet Explorer

### 目录结构

```text
components/          页面、图表与小型 UI 组件
lib/                 类型、格式化、演示数据与后端适配接口
app/globals.css      Material Design 3 设计令牌与响应式样式
public/              静态资源
docs/                接入与设计系统文档
deploy/              可复制的部署示例
tests/               构建与安全边界测试
main.tsx              浏览器入口
```

### 安全提醒

提交前请运行 `npm run check`，并检查暂存区。不要提交 `.env`、真实 IP、用户名、密码、Cookie、订阅地址、私钥、证书或云厂商凭据。演示数据应使用 `example.test`、RFC 5737 IPv4 和 RFC 3849 IPv6 文档地址。

安全问题请按 [`SECURITY.md`](SECURITY.md) 私下报告。参与开发请参阅 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

## English

### Features

- Overview with quota, exhaustion forecast, CPU, memory, disk, and load
- Account creation, filtering, status, quota, expiry, and password-reset handoff
- Live protocol, account, source IP, connection count, rate, and duration views
- Daily/monthly traffic, account ranking, protocol distribution, and trends
- Per-account subscription links, token rotation, copy, and QR interactions
- IPv4/IPv6 latency, jitter, packet loss, and history
- Service health, alert center, and audit history
- Light, dark, system, and five color themes
- Responsive desktop, tablet, and mobile navigation

### Quick start

Node.js 20.19 or newer is required.

```bash
git clone <your-repository-url>
cd Material-Design-CastoriceUI
npm ci
npm run dev
```

Open `http://localhost:5173`. Run the complete validation and production build with:

```bash
npm run check
```

The deployable static site is written to `dist/`.

### Deployment

CastoriceUI uses hash routing, so it needs no framework server and no route-specific rewrite rules. Serve `dist/` from Nginx, Apache, an object-storage website, or a static hosting provider. See [`deploy/nginx.conf.example`](deploy/nginx.conf.example) for a minimal Nginx configuration.

Terminate TLS and implement authentication, rate limiting, and security headers in your reverse proxy or backend. Never embed passwords, API tokens, certificate material, or infrastructure credentials in this frontend.

### Backend integration

Browser-safe domain models are in `lib/types.ts`; the backend-neutral contract is in `lib/data-provider.ts`. A trusted backend should collect and sanitize Hysteria2, AnyTLS, sing-box, system, and database data before returning it to the UI.

The browser must never receive privileged upstream credentials or direct access to management ports, Docker, systemd, or a database. See [`docs/INTEGRATION.md`](docs/INTEGRATION.md) for endpoint guidance and security requirements.

### Compatibility and performance

- ES2017 production target with clipboard, preference-storage, and media-query fallbacks
- Framework-independent modal implementation for older Safari and embedded WebViews
- Locally packaged fonts and icons; no runtime font CDN
- Lazy-loaded pages and lightweight SVG charts; no heavyweight component or chart framework
- Intended for maintained Chrome, Edge, Firefox, Safari, and mobile variants; Internet Explorer is not supported

### License

[MIT](LICENSE)
