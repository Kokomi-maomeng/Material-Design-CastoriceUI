import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("production entry contains metadata, viewport, and mount point", async () => {
  const html = await read("index.html");
  assert.match(html, /<title>CastoriceUI<\/title>/i);
  assert.match(html, /<div id="root"><\/div>/i);
  assert.match(html, /<script type="module" src="\/main\.tsx"><\/script>/i);
  assert.match(html, /name="viewport"/i);
});

test("v3.0 production UI never falls back to fabricated dashboard data", async () => {
  const [app, empty] = await Promise.all([read("components/CastoriceApp.tsx"), read("lib/empty-dashboard.ts")]);
  assert.doesNotMatch(app, /previewDashboard|mode === "preview"|示例数据模式/);
  assert.match(app, /没有显示任何示例数据/);
  assert.match(app, /mode: "stale"/);
  assert.doesNotMatch(empty, /example\.test|203\.0\.113\.|198\.51\.100\.|2001:db8:/);
  await assert.rejects(read("lib/demo-data.ts"));
});

test("v3.0 uses application sessions, CSRF, and no browser Basic Auth prompt", async () => {
  const [client, server, nginx, backendPackage] = await Promise.all([
    read("lib/api.ts"), read("server/castoriceui/api.py"), read("deploy/nginx.conf.example"), read("server/castoriceui/__init__.py"),
  ]);
  assert.match(client, /X-CSRF-Token/);
  assert.match(client, /\/api\/v2\/auth\/login/);
  assert.match(server, /HttpOnly/);
  assert.match(server, /SameSite=Strict/);
  assert.match(server, /authentication_lock/);
  assert.doesNotMatch(nginx, /^\s*auth_basic\s+"/m);
  assert.match(backendPackage, /__version__ = "3\.0\.0"/);
});

test("first run is protected by a one-time token and requires basics before overview", async () => {
  const [auth, firstRun, server, runner] = await Promise.all([
    read("components/auth/AuthPage.tsx"), read("components/setup/FirstRunConfiguration.tsx"), read("server/castoriceui/api.py"), read("server/run.py"),
  ]);
  assert.match(auth, /bootstrapToken/);
  assert.match(runner, /--generate-bootstrap/);
  assert.match(server, /consume_bootstrap/);
  assert.match(server, /basic_setup_required/);
  assert.match(firstRun, /onSaveBasics/);
  assert.match(firstRun, /onComplete/);
  assert.match(firstRun, /不会写入示例数据/);
});

test("Chinese, English, and system language modes are available across UI modules", async () => {
  const [i18n, app, integrations] = await Promise.all([read("lib/i18n.tsx"), read("components/CastoriceApp.tsx"), read("lib/integrations.ts")]);
  assert.match(i18n, /"system" \| "zh" \| "en"/);
  assert.match(i18n, /return "en"/);
  assert.match(app, /Follow system/);
  assert.match(integrations, /LocalizedText/);
  const componentFiles = (await readdir(new URL("components/", root), { recursive: true })).filter((name) => /\.(?:ts|tsx)$/.test(name));
  for (const name of componentFiles) {
    const content = await read(`components/${name.replaceAll("\\", "/")}`);
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      if (!/\p{Script=Han}/u.test(line)) continue;
      const context = lines.slice(Math.max(0, index - 4), index + 5).join("\n");
      const bilingualAuditMapping = name.endsWith("AuditPage.tsx") && (
        /^\s*(?:"[^"]*[\p{Script=Han}][^"]*"|[\p{Script=Han}]+):\s*"[^"]+",?$/u.test(line) ||
        /^\s*"[^"]*[\p{Script=Han}][^"]*":\s*$/u.test(line) && /^\s*"[^"]+",?$/u.test(lines[index + 1] ?? "") ||
        /\.replace\(\/\^.*[\p{Script=Han}].*\$\/,\s*"[^"]+"\)/u.test(line)
      );
      assert.ok(bilingualAuditMapping || /\bt\(|nameEn=|descriptionEn=|\bzh:|category ===|result ===|useState<"全部"|AUDIT_(?:ACTION|DETAIL)_EN/.test(context), `Unlocalized visible Chinese in ${name}: ${line.trim()}`);
    }
  }
});

test("navigation badges are removed while notifications hide zero and cap at 99+", async () => {
  const [navigation, app] = await Promise.all([read("lib/navigation.ts"), read("components/CastoriceApp.tsx")]);
  assert.doesNotMatch(navigation, /badge/);
  assert.match(app, /unacknowledgedAlerts > 0/);
  assert.match(app, /unacknowledgedAlerts > 99 \? "99\+"/);
  assert.match(app, /snapshot-time/);
  assert.doesNotMatch(app, /后端快照 ·/);
});

test("connections group honestly, copy source IPs, and omit explanatory footer clutter", async () => {
  const [page, collector, dashboard] = await Promise.all([read("components/pages/ConnectionsPage.tsx"), read("server/castoriceui/collectors.py"), read("server/castoriceui/dashboard.py")]);
  assert.match(page, /copyText\(item\.sourceIp\)/);
  assert.doesNotMatch(page, /同协议、账号和来源 IP 自动合并/);
  assert.doesNotMatch(page, /速率由相邻真实累计字节快照计算/);
  assert.match(collector, /if not protocol:\s+continue/);
  assert.match(collector, /inboundTags/);
  assert.match(dashboard, /aggregate_connections/);
});

test("network targets are editable and charts use real smooth sample paths", async () => {
  const [network, chart, collector, api] = await Promise.all([read("components/pages/NetworkPage.tsx"), read("components/charts/TrafficChart.tsx"), read("server/castoriceui/collectors.py"), read("lib/api.ts")]);
  assert.match(network, /updateNetworkTargets/);
  assert.match(network, /FeatureIntro/);
  assert.match(network, /order/);
  assert.match(network, /smoothPath/);
  assert.match(chart, / C /);
  assert.match(chart, /getScreenCTM\(\)/);
  assert.match(chart, /matrix\.inverse\(\)/);
  assert.match(network, /getScreenCTM\(\)/);
  assert.match(network, /sparkline-hit-area/);
  assert.match(collector, /"-c", "8"/);
  assert.match(api, /settings\/network-targets/);
});

test("v3.0 settings and floating surfaces follow the requested Material interactions", async () => {
  const [app, styles, types, backend] = await Promise.all([
    read("components/CastoriceApp.tsx"), read("app/globals.css"), read("lib/types.ts"), read("server/castoriceui/api.py"),
  ]);
  assert.match(app, /closeFloatingMenus/);
  assert.match(app, /dateMenuRef/);
  assert.match(app, /userMenuRef/);
  assert.match(app, /idleTimeoutMinutes \* 60_000/);
  assert.match(app, /panelTitle/);
  assert.match(app, /主题风格/);
  assert.match(app, /function SettingsSwitch/);
  assert.match(app, /className={`md-switch settings-switch-control/);
  assert.doesNotMatch(app, /uiSettings\.showSetup \? t\("开启"/);
  assert.doesNotMatch(app, /checked \? t\("显示"/);
  assert.match(styles, /\.floating-surface\.is-open/);
  assert.match(styles, /settings-disclosure::details-content/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.match(types, /idleTimeoutMinutes: 2 \| 5 \| 10 \| 15 \| 20 \| 30/);
  assert.doesNotMatch(app, /Never sign out automatically/);
  assert.match(backend, /panelTitle must contain 1 to 40 printable characters/);
});

test("v3.0 keeps chart time, mobile scrolling, setup order, and toast motion consistent", async () => {
  const [chart, network, setup, toast, styles, types, dashboard] = await Promise.all([
    read("components/charts/TrafficChart.tsx"), read("components/pages/NetworkPage.tsx"), read("components/setup/SetupPanel.tsx"),
    read("components/ui/Toast.tsx"), read("app/globals.css"), read("lib/types.ts"), read("server/castoriceui/dashboard.py"),
  ]);
  assert.match(types, /capturedAt\?: string/);
  assert.match(dashboard, /"capturedAt"/);
  assert.match(chart, /Intl\.DateTimeFormat/);
  assert.match(chart, /index === data\.length - 1/);
  assert.match(styles, /\.chart--traffic \.native-chart \{ width: 680px; min-width: 680px; \}/);
  assert.match(network, /const pick = \(event: PointerEvent<SVGSVGElement>\)/);
  assert.ok(setup.indexOf("setup-completed--first") < setup.indexOf("setup-list--pending"));
  assert.match(toast, /is-leaving/);
  assert.match(styles, /@keyframes toast-out-v24/);
});

test("subscription hints are removed and traffic quota remains one shared value", async () => {
  const [subscriptions, overview, accounts, dashboard, app] = await Promise.all([
    read("components/pages/SubscriptionsPage.tsx"), read("components/pages/OverviewPage.tsx"), read("components/pages/AccountsPage.tsx"), read("server/castoriceui/dashboard.py"), read("components/CastoriceApp.tsx"),
  ]);
  assert.doesNotMatch(subscriptions, /FeatureIntro|独立入口|快速导入/);
  assert.doesNotMatch(subscriptions, /tokenHint|updatedAt|lastFetchedAt|订阅安全提示|Subscription security/);
  assert.match(overview, /流量使用趋势/);
  assert.match(accounts, /统一额度/);
  assert.match(dashboard, /"quotaBytes": int\(self\.storage\.get_setting/);
  assert.match(app, /quota-input-stable/);
});

test("v3.0 quota schedules, stable live layouts, and requested removals stay wired end to end", async () => {
  const [app, api, collector, dashboard, connections, traffic, network, overview, services, audit, styles, security] = await Promise.all([
    read("components/CastoriceApp.tsx"), read("server/castoriceui/api.py"), read("server/castoriceui/collectors.py"),
    read("server/castoriceui/dashboard.py"), read("components/pages/ConnectionsPage.tsx"), read("components/pages/TrafficPage.tsx"),
    read("components/pages/NetworkPage.tsx"), read("components/pages/OverviewPage.tsx"), read("server/castoriceui/collectors.py"), read("components/pages/AuditPage.tsx"),
    read("app/globals.css"), read("server/castoriceui/security.py"),
  ]);
  for (const unit of ["day", "week", "month", "year"]) assert.match(`${app}\n${api}\n${collector}`, new RegExp(`"${unit}"`));
  assert.match(api, /traffic_quota/);
  assert.match(collector, /nextReset/);
  assert.match(connections, /const columns = 8/);
  assert.doesNotMatch(traffic, /容量预测|Capacity forecast/);
  assert.doesNotMatch(`${overview}\n${dashboard}\n${styles}`, /coverageComplete|trafficCoverage|forecast-card/);
  assert.doesNotMatch(`${network}\n${overview}\n${dashboard}`, /探测说明|最近缓存探测|5 minutes old|最多缓存 5 分钟|cached for five minutes/);
  assert.doesNotMatch(services, /"id": "updates"/);
  assert.doesNotMatch(audit, /审计保留策略|Audit retention/);
  assert.match(styles, /\.toast \{ z-index: 240; \}/);
  assert.match(security, /fetch_https_image_api/);
  assert.match(dashboard, /time\.monotonic\(\) - self\.network_at > 5/);
});

test("optional account expiry values cannot crash the account page", async () => {
  const format = await read("lib/format.ts");
  assert.match(format, /!value \|\| Number\.isNaN\(date\.getTime\(\)\)/);
  assert.match(format, /return "—"/);
});

test("common sing-box protocols are explicit and unmatched connections stay hidden", async () => {
  const [types, definitions, backend] = await Promise.all([read("lib/types.ts"), read("lib/integrations.ts"), read("server/castoriceui/config.py")]);
  for (const protocol of ["VLESS", "SOCKS5", "Shadowsocks", "VMess", "Trojan", "TUIC"]) assert.match(`${types}\n${definitions}`, new RegExp(protocol));
  for (const id of ["vless", "socks5", "shadowsocks", "vmess", "trojan", "tuic"]) assert.match(backend, new RegExp(`"${id}"`));
  assert.match(definitions, /xtls-rprx-vision/);
  assert.match(definitions, /Reality/);
});

test("v3.0 detail interactions avoid native or stale UI artifacts", async () => {
  const [app, styles, audit, traffic, donut, login] = await Promise.all([
    read("components/CastoriceApp.tsx"), read("app/globals.css"), read("components/pages/AuditPage.tsx"),
    read("components/charts/TrafficChart.tsx"), read("components/charts/DonutChart.tsx"), read("components/auth/AuthPage.tsx"),
  ]);
  assert.match(app, /notification-badge/);
  assert.doesNotMatch(styles, /notification-button span:last-child/);
  assert.match(app, /toastSequence/);
  assert.match(app, /const dismissToast = useCallback/);
  assert.match(app, /key={`setup-\${selectedSetup \?\? "closed"}`}/);
  assert.match(app, /key={`toast-\${toast\?\.id \?\? "closed"}`}/);
  assert.doesNotMatch(app, /onDismiss=\{\(\) => setToast\(null\)\}/);
  assert.match(app, /snapshot-date/);
  assert.match(audit, /fetchAudits/);
  assert.match(audit, /pageSize: expanded \? 50 : 30/);
  assert.match(audit, /pageItems/);
  assert.match(traffic, /chart-inspector/);
  assert.doesNotMatch(`${traffic}\n${donut}`, /<title>/);
  assert.doesNotMatch(login, /凭据只发送到当前面板后端|Use your panel account to access live server data/);
});

test("v3.0 scopes alert acknowledgement and audit history on the server", async () => {
  const [app, client, dashboard, storage, packageJson, packager] = await Promise.all([
    read("components/CastoriceApp.tsx"), read("lib/api.ts"), read("server/castoriceui/dashboard.py"),
    read("server/castoriceui/storage.py"), read("package.json"), read("scripts/package-release.mjs"),
  ]);
  assert.match(app, /await acknowledgeAlert\(id\)/);
  assert.match(app, /Unable to acknowledge the alert/);
  assert.match(client, /\/api\/v2\/audits\?/);
  assert.doesNotMatch(dashboard, /"auditEvents"/);
  assert.match(storage, /def reconcile_alerts/);
  assert.match(storage, /acknowledged_at=NULL/);
  assert.match(packageJson, /"release:package"/);
  assert.match(packager, /Duplicate logical frontend asset/);
  assert.match(packager, /SHA256SUMS\.txt/);
});

test("backend examples remain loopback-only and secret-free", async () => {
  const config = JSON.parse(await read("server/config.example.json"));
  assert.equal(config.listen_host, "127.0.0.1");
  assert.match(config.hysteria_api.url, /^http:\/\/127\.0\.0\.1:/);
  assert.match(config.singbox_api.url, /^http:\/\/127\.0\.0\.1:/);
  assert.equal(config.secure_cookies, true);
  assert.equal(config.redact_live_data, true);
  assert.deepEqual(config.external_background_hosts, []);
  assert.doesNotMatch(JSON.stringify(config), /BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/);
});

test("v3.0 fails closed for config, payload fields, traffic resets, login abuse, and repository metadata", async () => {
  const [config, dashboard, storage, collector, nginx, security, sensitiveScan] = await Promise.all([
    read("server/castoriceui/config.py"), read("server/castoriceui/dashboard.py"), read("server/castoriceui/storage.py"),
    read("server/castoriceui/collectors.py"), read("deploy/nginx.conf.example"), read("server/castoriceui/security.py"),
    read("scripts/sensitive-scan.mjs"),
  ]);
  assert.match(config, /Unknown configuration field/);
  assert.match(config, /listen_host must be a loopback IP address/);
  assert.match(dashboard, /public_accounts/);
  assert.doesNotMatch(dashboard, /"tokenHint"/);
  assert.match(nginx, /proxy_set_header Host \$http_host/);
  assert.match(nginx, /proxy_set_header X-Forwarded-Host \$http_host/);
  assert.match(storage, /traffic_usage_since/);
  assert.match(storage, /login_failures/);
  assert.match(collector, /boot_id/);
  assert.match(nginx, /limit_req zone=castorice_api/);
  assert.match(security, /host is not allowlisted/);
  assert.match(sensitiveScan, /cwd: root/);
  assert.doesNotMatch(sensitiveScan, /cwd: new URL\("\.\."/);
  assert.match(sensitiveScan, /GITHUB_EVENT_NAME === "pull_request" \? "HEAD\^2" : "HEAD"/);
});
