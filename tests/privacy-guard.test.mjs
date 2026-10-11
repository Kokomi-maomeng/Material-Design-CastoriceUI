import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { checkPayload, isNoreply, loadPrivateValues } from "../scripts/privacy-policy.mjs";
import { scanHistory } from "../scripts/sensitive-scan.mjs";

const source = fileURLToPath(new URL("../", import.meta.url));
const guard = path.join(source, "scripts/privacy-guard.mjs");
const email = "53976253+Kokomi-maomeng@users.noreply.github.com";
const privateEmail = "fixture@example.invalid";
const fakeToken = "ghp_" + "A".repeat(24);
const runGit = (directory, args) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
const runGuard = (directory, mode, args = [], options = {}) => spawnSync(process.execPath, [guard, mode, ...args], { cwd: directory, encoding: "utf8", ...options });

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "castorice-privacy-test-"));
  t.after(async () => {
    if (!path.resolve(directory).startsWith(path.join(os.tmpdir(), "castorice-privacy-test-"))) throw new Error("Unsafe fixture cleanup target");
    await rm(directory, { recursive: true, force: true });
  });
  runGit(directory, ["init", "--initial-branch=main"]);
  runGit(directory, ["config", "user.name", "Privacy Fixture"]);
  runGit(directory, ["config", "user.email", email]);
  await cp(path.join(source, ".githooks"), path.join(directory, ".githooks"), { recursive: true });
  await mkdir(path.join(directory, "scripts"));
  for (const name of ["privacy-guard.mjs", "privacy-policy.mjs", "sensitive-scan.mjs", "release-archive-entries.py"]) await cp(path.join(source, "scripts", name), path.join(directory, "scripts", name));
  execFileSync(process.execPath, [path.join(source, "scripts/install-privacy-hooks.mjs")], { cwd: directory, stdio: "pipe" });
  return directory;
}

async function cleanCommit(directory) {
  await writeFile(path.join(directory, "fixture.txt"), "safe fixture\n");
  runGit(directory, ["add", "fixture.txt"]);
  runGit(directory, ["commit", "-m", "Safe fixture"]);
  return runGit(directory, ["rev-parse", "HEAD"]).trim();
}

test("only GitHub noreply identities are accepted; examples do not bypass co-author rules", () => {
  assert.ok(isNoreply(email));
  assert.ok(isNoreply("github-actions[bot]@users.noreply.github.com"));
  assert.ok(isNoreply("noreply@github.com"));
  assert.ok(!isNoreply(privateEmail));
  assert.deepEqual(checkPayload("documentation contact: user@example.test"), []);
  assert.ok(checkPayload(`Co-authored-by: Fixture <${privateEmail}>`).length);
  assert.deepEqual(checkPayload("Co-authored-by: Copilot <copilot@github.com>"), []);
});

test("binary email-shaped bytes do not cause false positives; known values and UTF-16 remain checked", () => {
  const address = "fixture" + "@personal" + ".example";
  const binary = Buffer.concat([Buffer.from([0xff, 0x00]), Buffer.from(address)]);
  assert.deepEqual(checkPayload(binary), []);
  assert.ok(checkPayload(binary, [address]).length);
  assert.ok(checkPayload(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(address, "utf16le")])).length);
});

test("actual pre-commit hook blocks a command-line author override and private committer", async (t) => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, "fixture.txt"), "safe\n");
  runGit(directory, ["add", "fixture.txt"]);
  const author = spawnSync("git", ["commit", "--author", `Fixture <${privateEmail}>`, "-m", "Should be blocked"], { cwd: directory, encoding: "utf8" });
  assert.notEqual(author.status, 0);
  assert.doesNotMatch(author.stderr, new RegExp(privateEmail));
  const committer = runGuard(directory, "commit", [], { env: { ...process.env, GIT_COMMITTER_EMAIL: privateEmail } });
  assert.notEqual(committer.status, 0);
  assert.doesNotMatch(committer.stderr, new RegExp(privateEmail));
});

test("staged data is checked even when the working copy was made clean", async (t) => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, "fixture.txt"), fakeToken);
  runGit(directory, ["add", "fixture.txt"]);
  await writeFile(path.join(directory, "fixture.txt"), "safe working copy");
  const result = runGuard(directory, "commit");
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes("Index object"));
  assert.ok(!result.stderr.includes(fakeToken));
});

test("commit-msg hook rejects private co-author trailers", async (t) => {
  const directory = await fixture(t);
  await writeFile(path.join(directory, "fixture.txt"), "safe\n");
  runGit(directory, ["add", "fixture.txt"]);
  const result = spawnSync("git", ["commit", "-m", `Fixture\n\nCo-authored-by: Fixture <${privateEmail}>`], { cwd: directory, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes("co-author"));
  assert.doesNotMatch(result.stderr, new RegExp(privateEmail));
});

test("pre-push blocks history content even after its deletion", async (t) => {
  const directory = await fixture(t);
  await cleanCommit(directory);
  await writeFile(path.join(directory, "fixture.txt"), fakeToken);
  runGit(directory, ["add", "fixture.txt"]);
  runGit(directory, ["-c", "core.hooksPath=disabled-fixture-hooks", "commit", "-m", "Unsafe test fixture"]);
  await cleanCommit(directory);
  const sha = runGit(directory, ["rev-parse", "HEAD"]).trim();
  const result = runGuard(directory, "push", [], { input: `refs/heads/main ${sha} refs/heads/main ${"0".repeat(40)}\n` });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes("Git object"));
  assert.ok(!result.stderr.includes(fakeToken));
});

test("an unreferenced annotated tag SHA cannot bypass tagger checking", async (t) => {
  const directory = await fixture(t);
  await cleanCommit(directory);
  runGit(directory, ["-c", `user.email=${privateEmail}`, "tag", "-a", "unsafe", "-m", "Fixture tag"]);
  const sha = runGit(directory, ["rev-parse", "refs/tags/unsafe"]).trim();
  runGit(directory, ["tag", "-d", "unsafe"]);
  const result = runGuard(directory, "push", [], { input: `refs/tags/unsafe ${sha} refs/tags/unsafe ${"0".repeat(40)}\n` });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes("Git identity"));
  assert.doesNotMatch(result.stderr, new RegExp(privateEmail));
});

test("real push to a local bare repository passes clean data and blocks private history", async (t) => {
  const directory = await fixture(t);
  await cleanCommit(directory);
  const remote = path.join(directory, "local-remote.git");
  runGit(directory, ["init", "--bare", remote]);
  runGit(directory, ["push", remote, "main"]);
  runGit(directory, ["-c", "core.hooksPath=disabled-fixture-hooks", "commit", "--allow-empty", "--author", `Fixture <${privateEmail}>`, "-m", "Unsafe test fixture"]);
  const result = spawnSync("git", ["push", remote, "main"], { cwd: directory, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes("Privacy") || result.stderr.includes("Git identity"));
  assert.doesNotMatch(result.stderr, new RegExp(privateEmail));
});

test("shallow history is refused instead of reported clean", async (t) => {
  const directory = await fixture(t);
  await cleanCommit(directory);
  const shallow = path.join(directory, "shallow-copy");
  runGit(directory, ["clone", "--depth=1", pathToFileURL(directory).href, shallow]);
  await assert.rejects(scanHistory(shallow, ["--all"], []), /shallow/);
});

test("known-value lists stay local, and missing or in-repository policies block", async (t) => {
  const directory = await fixture(t);
  const values = path.join(directory, "local-values.json");
  await writeFile(values, JSON.stringify(["private-fixture-marker"]));
  runGit(directory, ["config", "castoriceui.privateValuesFile", values]);
  await assert.rejects(loadPrivateValues(directory), /inside/);
  runGit(directory, ["config", "castoriceui.privateValuesFile", path.join(directory, "missing.json")]);
  assert.notEqual(runGuard(directory, "commit").status, 0);
  assert.ok(checkPayload("private-fixture-marker", ["private-fixture-marker"]).length);
  const allowedFile = path.join(directory, "outside-policy", "values.json");
  await mkdir(path.dirname(allowedFile));
  await writeFile(allowedFile, JSON.stringify(["private-fixture-marker"]));
  const isolatedRepo = path.join(directory, "separate-repo");
  await mkdir(isolatedRepo);
  runGit(isolatedRepo, ["init"]);
  runGit(isolatedRepo, ["config", "castoriceui.privateValuesFile", allowedFile]);
  assert.deepEqual(await loadPrivateValues(isolatedRepo), ["private-fixture-marker"]);
});

test("installer preserves pre-existing hooks instead of masking them", async (t) => {
  const directory = await fixture(t);
  runGit(directory, ["config", "--unset", "core.hooksPath"]);
  const hooks = path.resolve(directory, runGit(directory, ["rev-parse", "--git-path", "hooks"]).trim());
  await mkdir(hooks, { recursive: true });
  await writeFile(path.join(hooks, "pre-commit"), "#!/bin/sh\nexit 0\n");
  const result = spawnSync(process.execPath, [path.join(source, "scripts/install-privacy-hooks.mjs")], { cwd: directory, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes("not replaced"));
});

test("release staging rejects a sensitive directory even with harmless file contents", async (t) => {
  const directory = await fixture(t);
  const staging = path.join(directory, "stage");
  await mkdir(path.join(staging, "credentials-cache"), { recursive: true });
  await writeFile(path.join(staging, "credentials-cache", "fixture.txt"), "safe\n");
  const result = runGuard(directory, "directory", [staging]);
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes("Sensitive directory"));
  runGit(directory, ["add", "stage/credentials-cache/fixture.txt"]);
  assert.notEqual(runGuard(directory, "commit").status, 0);
  runGit(directory, ["-c", "core.hooksPath=disabled-fixture-hooks", "commit", "-m", "Unsafe path fixture"]);
  assert.ok((await scanHistory(directory, ["HEAD"], [])).some((finding) => finding.includes("Sensitive filename")));
});

test("archive guard scans real compressed bytes and rejects traversal and links", async (t) => {
  const directory = await fixture(t);
  const archive = path.join(directory, "fixture.tar.gz");
  const python = process.platform === "win32" ? "python" : "python3";
  const create = (name, content, symlink = false, paxValue = "") => execFileSync(python, ["-c", "import io,sys,tarfile; data=sys.argv[3].encode(); t=tarfile.open(sys.argv[1],'w:gz',format=tarfile.PAX_FORMAT); i=tarfile.TarInfo(sys.argv[2]); i.size=len(data); i.type=tarfile.SYMTYPE if sys.argv[4]=='yes' else tarfile.REGTYPE; i.linkname='outside'; i.pax_headers={'comment':sys.argv[5]}; t.addfile(i,io.BytesIO(data) if i.isfile() else None); t.close()", archive, name, content, symlink ? "yes" : "no", paxValue], { stdio: "pipe" });
  create("safe.txt", "safe\n");
  assert.equal(runGuard(directory, "archive", [archive]).status, 0);
  create("leak.txt", fakeToken);
  const leaked = runGuard(directory, "archive", [archive]);
  assert.notEqual(leaked.status, 0);
  assert.ok(!leaked.stderr.includes(fakeToken));
  create("../escape.txt", "safe");
  assert.notEqual(runGuard(directory, "archive", [archive]).status, 0);
  create("link.txt", "", true);
  assert.notEqual(runGuard(directory, "archive", [archive]).status, 0);
  create("safe.txt", "safe", false, fakeToken);
  assert.notEqual(runGuard(directory, "archive", [archive]).status, 0);
  create(".git/config", "safe");
  assert.notEqual(runGuard(directory, "archive", [archive]).status, 0);
  create("credentials-cache/fixture.txt", "safe");
  assert.notEqual(runGuard(directory, "archive", [archive]).status, 0);
});
