import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkDocLinks } from "./check-doc-links.mjs";
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const lock = JSON.parse(await readFile(new URL("../package-lock.json", import.meta.url), "utf8"));
if (lock.version !== version || lock.packages[""].version !== version) throw new Error("Package lock version is stale");
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const deployment = await readFile(new URL("../docs/DEPLOYMENT.md", import.meta.url), "utf8");
const contributing = await readFile(new URL("../CONTRIBUTING.md", import.meta.url), "utf8");
if (!readme.includes(`version-${version}-`) || !readme.includes(`RELEASE_NOTES_v${version}.md`)) throw new Error("Current README version is stale");
for (const [file, document] of [["README.md", readme], ["docs/DEPLOYMENT.md", deployment], ["CONTRIBUTING.md", contributing]]) {
  const versionReferences = /(?:CastoriceUI-v|releases\/(?:download|tag)\/v|RELEASE_NOTES_v|version-|"version"\s*:\s*")(\d+\.\d+\.\d+)\b/g;
  for (const [, referencedVersion] of document.matchAll(versionReferences)) {
    if (referencedVersion !== version) throw new Error(`Stale version ${referencedVersion} in ${file}`);
  }
}
if (!deployment.includes("release `VERSION` file")) throw new Error("Deployment acceptance must use the release version metadata");
await readFile(new URL(`../docs/RELEASE_NOTES_v${version}.md`, import.meta.url));
const root = fileURLToPath(new URL("../", import.meta.url));
await checkDocLinks(root);
const integration = await readFile(new URL("../docs/INTEGRATION.md", import.meta.url), "utf8");
const api = await readFile(new URL("../server/castoriceui/api.py", import.meta.url), "utf8");
for (const [, route] of api.matchAll(/path == "(\/api\/v2\/[^"]+)"/g)) {
  if (!integration.includes("`" + route + "`")) throw new Error("Undocumented current API route: " + route);
}
const support = await readFile(new URL("../docs/SUPPORT_MATRIX.md", import.meta.url), "utf8");
if (/\| External business probes \|/.test(support)) throw new Error("Removed observer must not be a current capability");
console.log("Current release documentation, API routes and local links passed.");
