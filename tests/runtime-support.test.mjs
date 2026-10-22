import assert from "node:assert/strict";
import test from "node:test";
import { supportedNode } from "../scripts/check-runtime.mjs";

test("source runtime guard rejects unsupported version gaps before building", () => {
  for (const version of ["18.20.0", "20.18.9", "21.9.0", "22.11.9", "23.0.0"]) assert.equal(supportedNode(version), false, version);
  for (const version of ["20.19.0", "22.12.0", "24.22.1", "26.0.0"]) assert.equal(supportedNode(version), true, version);
});
