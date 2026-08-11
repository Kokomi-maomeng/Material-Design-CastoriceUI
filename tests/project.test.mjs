import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("production entry contains metadata, viewport, and mount point", async () => {
  const html = await read("index.html");
  assert.match(html, /<title>Material-Design CastoriceUI<\/title>/i);
  assert.match(html, /<div id="root"><\/div>/i);
  assert.match(html, /<script type="module" src="\/main\.tsx"><\/script>/i);
  assert.match(html, /name="viewport"/i);
});

test("v2.1 production UI never falls back to fabricated dashboard data", async () => {
  const [app, empty] = await Promise.all([read("components/CastoriceApp.tsx"), read("lib/empty-dashboard.ts")]);
  assert.doesNotMatch(app, /previewDashboard|mode === "preview"|示例数据模式/);
  assert.match(app, /没有显示任何示例数据/);
  assert.match(app, /mode: "stale"/);
  assert.doesNotMatch(empty, /example\.test|203\.0\.113\.|198\.51\.100\.|2001:db8:/);
  await assert.rejects(read("lib/demo-data.ts"));
});

test("v2.1 uses application sessions, CSRF, and no browser Basic Auth prompt", async () => {
  const [client, server, nginx, backendPackage] = await Promise.all([
    read("lib/api.ts"), read("server/castoriceui/api.py"), read("deploy/nginx.conf.example"), read("server/castoriceui/__init__.py"),
  ]);
  assert.match(client, /X-CSRF-Token/);
  assert.match(client, /\/api\/v2\/auth\/login/);
  assert.match(server, /HttpOnly/);
  assert.match(server, /SameSite=Strict/);
  assert.match(server, /authentication_lock/);
  assert.doesNotMatch(nginx, /^\s*auth_basic\s+"/m);
  assert.match(backendPackage, /__version__ = "2\.1\.0"/);
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
  assert.match(collector, /"-c", "8"/);
  assert.match(api, /settings\/network-targets/);
});

test("subscription hints are removed and traffic quota remains one shared value", async () => {
  const [subscriptions, overview, accounts, dashboard, app] = await Promise.all([
    read("components/pages/SubscriptionsPage.tsx"), read("components/pages/OverviewPage.tsx"), read("components/pages/AccountsPage.tsx"), read("server/castoriceui/dashboard.py"), read("components/CastoriceApp.tsx"),
  ]);
  assert.doesNotMatch(subscriptions, /FeatureIntro|独立入口|快速导入/);
  assert.match(overview, /流量使用趋势/);
  assert.match(accounts, /统一额度/);
  assert.match(dashboard, /account\["quotaBytes"\]/);
  assert.match(app, /quota-input-stable/);
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

test("v2.1 detail interactions avoid native or stale UI artifacts", async () => {
  const [app, styles, audit, traffic, donut, login] = await Promise.all([
    read("components/CastoriceApp.tsx"), read("app/globals.css"), read("components/pages/AuditPage.tsx"),
    read("components/charts/TrafficChart.tsx"), read("components/charts/DonutChart.tsx"), read("components/auth/AuthPage.tsx"),
  ]);
  assert.match(app, /notification-badge/);
  assert.doesNotMatch(styles, /notification-button span:last-child/);
  assert.match(app, /toastSequence/);
  assert.match(app, /snapshot-date/);
  assert.match(audit, /slice\(0, 30\)/);
  assert.match(audit, /\/ 50/);
  assert.match(audit, /pageItems/);
  assert.match(traffic, /chart-inspector/);
  assert.doesNotMatch(`${traffic}\n${donut}`, /<title>/);
  assert.doesNotMatch(login, /凭据只发送到当前面板后端|Use your panel account to access live server data/);
});

test("backend examples remain loopback-only and secret-free", async () => {
  const config = JSON.parse(await read("server/config.example.json"));
  assert.equal(config.listen_host, "127.0.0.1");
  assert.match(config.hysteria_api.url, /^http:\/\/127\.0\.0\.1:/);
  assert.match(config.singbox_api.url, /^http:\/\/127\.0\.0\.1:/);
  assert.equal(config.secure_cookies, true);
  assert.doesNotMatch(JSON.stringify(config), /BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/);
});
