import { readFile } from "node:fs/promises";
const { version } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const deployment = await readFile(new URL("../docs/DEPLOYMENT.md", import.meta.url), "utf8");
if (!readme.includes(`version-${version}-`) || !readme.includes(`RELEASE_NOTES_v${version}.md`)) throw new Error("Current README version is stale");
for (const match of deployment.matchAll(/CastoriceUI-v(\d+\.\d+\.\d+)\.tar\.gz/g)) {
  if (match[1] !== version) throw new Error("Current deployment archive version is stale");
}
if (!deployment.includes("release `VERSION` file")) throw new Error("Deployment acceptance must use the release version metadata");
await readFile(new URL(`../docs/RELEASE_NOTES_v${version}.md`, import.meta.url));
console.log("Current release documentation matches package metadata.");
