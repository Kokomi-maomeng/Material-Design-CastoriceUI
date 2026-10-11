import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkGitIdentityObject, checkPayload, forbiddenNames, hasSensitivePath, git, loadPrivateValues, readGitObjects } from "./privacy-policy.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ignoredDirectories = new Set([".git", ".next", ".vinext", ".wrangler", "node_modules", "__pycache__"]);

export async function scanDirectory(directory, privateValues) {
  const findings = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirectories.has(entry.name)) continue;
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) { findings.push("Filesystem symlink must be reviewed"); continue; }
    if (entry.isDirectory()) {
      if (forbiddenNames.test(entry.name) || checkPayload(entry.name, privateValues).length) findings.push("Sensitive directory name");
      findings.push(...await scanDirectory(filename, privateValues));
    }
    else {
      const reasons = [...(forbiddenNames.test(entry.name) ? ["sensitive filename"] : []), ...checkPayload(entry.name, privateValues), ...checkPayload(await readFile(filename), privateValues)];
      if (reasons.length) findings.push(`File rejected (${[...new Set(reasons)].join(", ")})`);
    }
  }
  return findings;
}

export async function scanHistory(directory, revisions, privateValues) {
  if (git(directory, ["rev-parse", "--is-shallow-repository"]).trim() === "true") throw new Error("Full Git history is required; shallow checkouts cannot pass");
  const entries = git(directory, ["rev-list", "--objects", ...revisions]).trim().split(/\r?\n/).filter(Boolean);
  const findings = [];
  for (const line of entries) {
    const separator = line.indexOf(" ");
    const filename = separator < 0 ? "" : line.slice(separator + 1);
    if (filename && (hasSensitivePath(filename) || checkPayload(filename, privateValues).length)) findings.push("Sensitive filename in Git history");
  }
  const ids = [...new Set(entries.map((line) => line.split(" ", 1)[0]))];
  for (const object of readGitObjects(directory, ids)) {
    const reasons = [...checkPayload(object.data, privateValues), ...checkGitIdentityObject(object.kind, object.data)];
    if (reasons.length) findings.push(`Git object ${object.id} rejected (${[...new Set(reasons)].join(", ")})`);
  }
  return findings;
}

async function main() {
  try {
    const privateValues = await loadPrivateValues(root);
    const findings = [...await scanDirectory(root, privateValues), ...await scanHistory(root, ["--all"], privateValues)];
    if (findings.length) { console.error(findings.join("\n")); process.exitCode = 1; }
    else console.log("Sensitive-content and Git identity scan passed (working files + complete local history).");
  } catch {
    console.error("Privacy scan blocked: files, local policy, or full Git history could not be inspected.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
