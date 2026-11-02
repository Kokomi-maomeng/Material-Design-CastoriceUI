// The entire dependency tree uses patched minimatch. Older lint plugins still
// require its former callable CommonJS export; retain the named API as well.
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const core = require("minimatch");
require.cache[require.resolve("minimatch")].exports = Object.assign(core.minimatch, core);
