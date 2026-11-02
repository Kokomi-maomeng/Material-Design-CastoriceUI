import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
await import("../scripts/minimatch-compat.mjs");
const minimatch = require("minimatch");

test("patched glob matching preserves callable and named APIs used by the lint toolchain", () => {
  assert.equal(typeof minimatch, "function");
  assert.equal(minimatch.minimatch, minimatch);
  assert.equal(minimatch("components/pages/NetworkPage.tsx", "**/*.{ts,tsx}"), true);
  assert.equal(minimatch("components/pages/NetworkPage.tsx", "*.tsx", { matchBase: true }), true);
  assert.equal(minimatch(".github/workflows/ci.yml", "**/*.yml"), false);
  assert.equal(minimatch(".github/workflows/ci.yml", "**/*.yml", { dot: true }), true);
  assert.equal(new minimatch.Minimatch("**/*.tsx").match("components/pages/NetworkPage.tsx"), true);
  assert.deepEqual(minimatch.match(["a.ts", "b.js"], "*.ts"), ["a.ts"]);
  const core = require("minimatch/package.json");
  assert.equal(core.version, "11.0.1");
});
