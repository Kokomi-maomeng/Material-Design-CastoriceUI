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
  assert.match(readme, /Never embed passwords.*API tokens/is);
  assert.match(integration, /browser must never receive/i);
  assert.match(provider, /CastoriceDataProvider/);
});
