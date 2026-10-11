import { access, chmod } from "node:fs/promises";
import path from "node:path";
import { git } from "./privacy-policy.mjs";

const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
let current = "";
try { current = git(root, ["config", "--get", "core.hooksPath"]).trim(); }
catch (error) { if (error.status !== 1) throw error; }
if (current && path.resolve(root, current) !== path.join(root, ".githooks")) throw new Error("Existing hooksPath must be integrated explicitly; it was not replaced");
if (!current) {
  const defaultDirectory = path.resolve(root, git(root, ["rev-parse", "--git-path", "hooks"]).trim());
  for (const hook of ["pre-commit", "commit-msg", "pre-push"]) {
    try { await access(path.join(defaultDirectory, hook)); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    throw new Error("Existing default hooks must be integrated explicitly; they were not replaced");
  }
}
for (const hook of ["pre-commit", "commit-msg", "pre-push"]) await chmod(path.join(root, ".githooks", hook), 0o755);
git(root, ["config", "--local", "core.hooksPath", ".githooks"]);
console.log("Repository-local privacy hooks installed; global Git settings unchanged.");
