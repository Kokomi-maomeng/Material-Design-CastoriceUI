import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("production entry contains the application metadata and mount point", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /<title>Material-Design CastoriceUI<\/title>/i);
  assert.match(html, /<div id="root"><\/div>/i);
  assert.match(html, /<script type="module" src="\/main\.tsx"><\/script>/i);
  assert.match(html, /name="viewport"/i);
});

test("keeps secrets out of documentation-safe demo data", async () => {
  const demo = await readFile(new URL("../lib/demo-data.ts", import.meta.url), "utf8");
  assert.match(demo, /example\.test/);
  assert.match(demo, /203\.0\.113\.|198\.51\.100\.|2001:db8:/);
  assert.doesNotMatch(demo, /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/);
  assert.doesNotMatch(demo, /gh[pousr]_[A-Za-z0-9_]{20,}/);
  assert.doesNotMatch(demo, /sk-[A-Za-z0-9]{20,}/);
});

test("documents the backend security boundary", async () => {
  const [readme, integration, provider] = await Promise.all([
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/INTEGRATION.md", import.meta.url), "utf8"),
    readFile(new URL("../lib/data-provider.ts", import.meta.url), "utf8"),
  ]);
  assert.match(readme, /private keys.*plaintext passwords are never returned/is);
  assert.match(integration, /browser must never receive/i);
  assert.match(provider, /CastoriceDataProvider/);
});

test("v1.2 keeps setup drafts in React session state only", async () => {
  const [app, wizard] = await Promise.all([
    readFile(new URL("../components/CastoriceApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/setup/SetupWizard.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(app, /setupDrafts/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^)]*setupDrafts/);
  assert.match(wizard, /刷新浏览器后不会保留未提交内容/);
});

test("backend examples stay loopback-only and secret-free", async () => {
  const config = JSON.parse(await readFile(new URL("../server/config.example.json", import.meta.url), "utf8"));
  assert.equal(config.listen_host, "127.0.0.1");
  assert.match(config.hysteria_api.url, /^http:\/\/127\.0\.0\.1:/);
  assert.match(config.singbox_api.url, /^http:\/\/127\.0\.0\.1:/);
  assert.doesNotMatch(JSON.stringify(config), /BEGIN (?:RSA |OPENSSH )?PRIVATE KEY/);
});

test("v1.2 exposes ten themes and removes misleading placeholder controls", async () => {
  const [app, network, pages] = await Promise.all([
    readFile(new URL("../components/CastoriceApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../components/pages/NetworkPage.tsx", import.meta.url), "utf8"),
    Promise.all([
      "AccountsPage.tsx", "ConnectionsPage.tsx", "TrafficPage.tsx", "SubscriptionsPage.tsx",
      "ServicesPage.tsx", "AlertsPage.tsx", "AuditPage.tsx",
    ].map((name) => readFile(new URL(`../components/pages/${name}`, import.meta.url), "utf8"))),
  ]);
  for (const color of ["violet", "blue", "green", "rose", "amber", "teal", "cyan", "indigo", "coral", "slate"]) {
    assert.match(app, new RegExp(`\\b${color}\\b`));
  }
  assert.doesNotMatch(network, /packet_mirror/i);
  assert.match(network, /暂无数据/);
  assert.doesNotMatch(pages.join("\n"), /需要后端授权|接入后端后启用|仅在当前页面生效/);
});
