import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const root = new URL("../", import.meta.url);
const ignoredDirectories = new Set([".git", ".next", ".vinext", ".wrangler", "dist", "node_modules"]);
const ignoredFiles = new Set(["package-lock.json"]);
const forbiddenNames = /(^|\/)(\.env(?:\..+)?|.*\.(?:key|pem|p12|pfx)|.*(?:credential|secret|password).*)$/i;
const forbiddenContent = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  new RegExp("-----BEGIN " + "CERTIFICATE-----"),
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /AIza[0-9A-Za-z_-]{30,}/,
  /(?:api[_-]?key|client[_-]?secret|access[_-]?token|password|passwd)\s*[:=]\s*["'][^"']{8,}["']/i,
];

async function collect(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...await collect(new URL(`${entry.name}/`, directory), relative));
    else if (!ignoredFiles.has(entry.name)) files.push(relative);
  }
  return files;
}

const findings = [];
for (const file of await collect(root)) {
  if (forbiddenNames.test(file)) {
    findings.push(`${file}: forbidden sensitive filename`);
    continue;
  }
  const content = await readFile(new URL(file, root), "utf8").catch(() => "");
  for (const pattern of forbiddenContent) {
    if (pattern.test(content)) findings.push(`${file}: matched ${pattern}`);
  }
}

if (findings.length > 0) {
  console.error(findings.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Sensitive-content scan passed.");
}
