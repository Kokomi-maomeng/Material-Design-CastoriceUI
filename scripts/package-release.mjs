import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const version = String(packageJson.version);
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid release version: ${version}`);
const backendVersion = await readFile(path.join(root, "server", "castoriceui", "__init__.py"), "utf8");
if (!backendVersion.includes(`__version__ = "${version}"`)) throw new Error("Frontend and backend release versions do not match");
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
  copy("server/config.example.json", "server/config.example.json"),
  copy("deploy", "deploy"),
  copy("docs/DEPLOYMENT.md", "docs/DEPLOYMENT.md"),
  copy("docs/INTEGRATION.md", "docs/INTEGRATION.md"),
  cp(releaseNotes, path.join(stageDirectory, "docs", `RELEASE_NOTES_v${version}.md`)),
  copy("docs/images/dashboard-mobile.png", "docs/images/dashboard-mobile.png"),
  copy("public/og.png", "public/og.png"),
  copy("README.md", "README.md"),
  copy("CONTRIBUTING.md", "CONTRIBUTING.md"),
  copy("SECURITY.md", "SECURITY.md"),
  copy("LICENSE", "LICENSE"),
]);

async function collectFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await collectFiles(target));
    else result.push(target);
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

for (const file of await collectFiles(stageDirectory)) {
  if ((await lstat(file)).isSymbolicLink()) throw new Error(`Release staging must not contain symlinks: ${file}`);
}

execFileSync("tar", ["-czf", archivePath, "-C", releaseDirectory, path.basename(stageDirectory)], { stdio: "inherit" });
const digest = createHash("sha256").update(await readFile(archivePath)).digest("hex");
await writeFile(path.join(releaseDirectory, "SHA256SUMS.txt"), `${digest}  ${archiveName}\n`, "utf8");
await rm(stageDirectory, { recursive: true, force: true });
await rm(buildDirectory, { recursive: true, force: true });
console.log(`Created ${path.relative(root, archivePath)} (${digest})`);
