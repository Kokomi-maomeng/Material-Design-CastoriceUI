import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = String(packageJson.version);
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid release version: ${version}`);
const releaseNotes = path.join(root, "docs", `RELEASE_NOTES_v${version}.md`);
await readFile(releaseNotes, "utf8");

const releaseDirectory = path.join(root, "release");
const stageDirectory = path.join(releaseDirectory, `CastoriceUI-v${version}`);
const archiveName = `CastoriceUI-v${version}.tar.gz`;
const archivePath = path.join(releaseDirectory, archiveName);
const buildDirectory = await mkdtemp(path.join(os.tmpdir(), `castoriceui-v${version}-`));

execFileSync(process.execPath, [path.join(root, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", buildDirectory, "--emptyOutDir"], {
  cwd: root,
  stdio: "inherit",
});

await rm(releaseDirectory, { recursive: true, force: true });
await mkdir(stageDirectory, { recursive: true });

const copy = (source, destination) => cp(path.join(root, source), path.join(stageDirectory, destination), { recursive: true });
await Promise.all([
  cp(buildDirectory, path.join(stageDirectory, "frontend"), { recursive: true }),
  copy("server/castoriceui", "server/castoriceui"),
  copy("server/tests", "server/tests"),
  copy("server/run.py", "server/run.py"),
  copy("server/preflight.py", "server/preflight.py"),
  copy("server/config.example.json", "server/config.example.json"),
  copy("deploy", "deploy"),
  copy("docs/DEPLOYMENT.md", "docs/DEPLOYMENT.md"),
  copy("docs/BROWSER_SUPPORT.md", "docs/BROWSER_SUPPORT.md"),
  copy("docs/INTEGRATION.md", "docs/INTEGRATION.md"),
  cp(releaseNotes, path.join(stageDirectory, "docs", `RELEASE_NOTES_v${version}.md`)),
  copy("public/og.png", "public/og.png"),
  copy("README.md", "README.md"),
  copy("CONTRIBUTING.md", "CONTRIBUTING.md"),
  copy("SECURITY.md", "SECURITY.md"),
  copy("LICENSE", "LICENSE"),
]);
await writeFile(
  path.join(stageDirectory, "server", "castoriceui", "_version.py"),
  `# Generated from package.json by scripts/package-release.mjs.\nVERSION = ${JSON.stringify(version)}\n`,
  "utf8",
);

async function collectEntries(directory) {
  const result = [];
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    result.push(target);
    if (entry.isDirectory()) result.push(...await collectEntries(target));
  }
  return result;
}

async function removePythonCaches(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__pycache__") await rm(target, { recursive: true, force: true });
      else await removePythonCaches(target);
    } else if (/\.pyc$/i.test(entry.name)) {
      await rm(target, { force: true });
    }
  }
}

const assetDirectory = path.join(stageDirectory, "frontend", "assets");
const assets = await readdir(assetDirectory);
const logicalAssets = new Map();
for (const asset of assets) {
  const match = asset.match(/^(.*)-[A-Za-z0-9_-]{8,}(\.[^.]+)$/);
  const logicalName = match ? `${match[1]}${match[2]}` : asset;
  if (logicalAssets.has(logicalName)) {
    throw new Error(`Duplicate logical frontend asset: ${logicalAssets.get(logicalName)} and ${asset}`);
  }
  logicalAssets.set(logicalName, asset);
}

await removePythonCaches(stageDirectory);

const stagedEntries = await collectEntries(stageDirectory);
for (const entry of stagedEntries) {
  if ((await lstat(entry)).isSymbolicLink()) throw new Error(`Release staging must not contain symlinks: ${entry}`);
}

const sourceDateEpochValue = process.env.SOURCE_DATE_EPOCH ?? "946684800";
if (!/^\d+$/.test(sourceDateEpochValue)) throw new Error("SOURCE_DATE_EPOCH must be a non-negative integer");
const sourceDateEpoch = Number(sourceDateEpochValue);
if (!Number.isSafeInteger(sourceDateEpoch) || sourceDateEpoch > 253402300799) {
  throw new Error("SOURCE_DATE_EPOCH is outside the supported range");
}
const normalizedTimestamp = new Date(sourceDateEpoch * 1000);
for (const entry of [stageDirectory, ...stagedEntries].reverse()) {
  await utimes(entry, normalizedTimestamp, normalizedTimestamp);
}

const archiveEntries = [stageDirectory, ...stagedEntries]
  .map((entry) => path.relative(releaseDirectory, entry).split(path.sep).join("/"))
  .sort((left, right) => left.localeCompare(right, "en"));
const archiveManifest = path.join(buildDirectory, "archive-manifest.txt");
await writeFile(archiveManifest, `${archiveEntries.join("\n")}\n`, "utf8");
const uncompressedArchive = path.join(buildDirectory, "release.tar");
execFileSync(
  "tar",
  ["--no-recursion", "-cf", uncompressedArchive, "-C", releaseDirectory, "-T", archiveManifest],
  { env: { ...process.env, COPYFILE_DISABLE: "1", TZ: "UTC" }, stdio: "inherit" },
);
await writeFile(archivePath, gzipSync(await readFile(uncompressedArchive), { level: 9, mtime: 0 }));
const digest = createHash("sha256").update(await readFile(archivePath)).digest("hex");
await writeFile(path.join(releaseDirectory, "SHA256SUMS.txt"), `${digest}  ${archiveName}\n`, "utf8");
await rm(stageDirectory, { recursive: true, force: true });
await rm(buildDirectory, { recursive: true, force: true });
console.log(`Created ${path.relative(root, archivePath)} (${digest})`);
