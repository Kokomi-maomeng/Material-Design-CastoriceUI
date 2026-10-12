import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkPayload, hasSensitivePath, git, isNoreply, loadPrivateValues, readGitObjects } from "./privacy-policy.mjs";
import { scanDirectory, scanHistory } from "./sensitive-scan.mjs";

try {
  const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
  const privateValues = await loadPrivateValues(root);
  const mode = process.argv[2];
  const findings = [];
  if (mode === "commit" || mode === "identity") {
    for (const role of ["GIT_AUTHOR_IDENT", "GIT_COMMITTER_IDENT"]) {
      const identity = git(root, ["var", role]).trim();
      const email = identity.match(/<([^<>]*)> \d+ [+-]\d{4}$/)?.[1];
      if (!email || !isNoreply(email) || checkPayload(identity, privateValues).length) findings.push(`${role} must use a public alias and GitHub noreply email`);
    }
  }
  if (mode === "commit") {
    const files = git(root, ["ls-files", "--stage", "-z"]).split("\0").filter(Boolean).map((line) => {
      const [, permissions, id, stage, filename] = line.match(/^(\d+) ([a-f0-9]+) (\d)\t([\s\S]+)$/) ?? [];
      if (!id || stage !== "0") throw new Error("Unmerged or unverifiable Git index");
      if (permissions === "120000" || permissions === "160000") findings.push("Index symlink/submodule requires a separate privacy review");
      if (hasSensitivePath(filename) || checkPayload(filename, privateValues).length) findings.push("Sensitive filename in Git index");
      return id;
    });
    for (const object of readGitObjects(root, [...new Set(files)])) {
      const reasons = checkPayload(object.data, privateValues);
      if (reasons.length) findings.push(`Index object ${object.id} rejected (${reasons.join(", ")})`);
    }
  } else if (mode === "message") {
    if (!process.argv[3]) throw new Error("Commit message path is required");
    findings.push(...checkPayload(await readFile(process.argv[3]), privateValues));
  } else if (mode === "push") {
    const input = readFileSync(0, "utf8");
    const revisions = [];
    for (const line of input.trim().split(/\r?\n/).filter(Boolean)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 4 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(fields[1])) throw new Error("Invalid pre-push input");
      if (!/^0+$/.test(fields[1])) revisions.push(fields[1]);
    }
    if (revisions.length) findings.push(...await scanHistory(root, [...new Set(revisions)], privateValues));
  } else if (mode === "directory") {
    if (!process.argv[3]) throw new Error("Release staging directory is required");
    findings.push(...await scanDirectory(path.resolve(process.argv[3]), privateValues));
  } else if (mode === "archive") {
    if (!process.argv[3]) throw new Error("Release archive path is required");
    const { execFileSync } = await import("node:child_process");
    const script = fileURLToPath(new URL("release-archive-entries.py", import.meta.url));
    const interpreter = process.platform === "win32" ? "python" : "python3";
    const entries = JSON.parse(execFileSync(interpreter, [script, path.resolve(process.argv[3])], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] }));
    for (const entry of entries) {
      const reasons = [...(hasSensitivePath(entry.name) || entry.name.split("/").includes(".git") ? ["sensitive archive filename"] : []), ...checkPayload(entry.name + "\n" + entry.owner, privateValues), ...checkPayload(Buffer.from(entry.content, "base64"), privateValues)];
      if (reasons.length) findings.push(`Archive member rejected (${[...new Set(reasons)].join(", ")})`);
    }
  } else if (mode !== "identity" && mode !== "commit") throw new Error("Unknown privacy guard mode");
  if (findings.length) { console.error([...new Set(findings)].join("\n")); process.exitCode = 1; }
  else console.log(`Privacy guard passed (${mode}); no private values printed.`);
} catch {
  console.error("Privacy guard blocked: identity, input, policy, archive, or Git objects could not be fully checked.");
  process.exitCode = 1;
}
