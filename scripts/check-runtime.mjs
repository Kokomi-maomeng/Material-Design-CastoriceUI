import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export function supportedNode(version) {
  const [major, minor] = version.replace(/^v/, "").split(".").map(Number);
  return major === 20 && minor >= 19 || major === 22 && minor >= 12 || major >= 24;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!supportedNode(process.versions.node)) {
    console.error("Use Node ^20.19.0 || ^22.12.0 || >=24.0.0. Tested LTS: Node 24.22.1. Update Node, then run npm ci.");
    process.exit(1);
  }
  const python = spawnSync(process.platform === "win32" ? "python" : "python3", ["--version"], { encoding: "utf8" });
  console.log(`Node ${process.versions.node}; ${process.env.npm_config_user_agent ?? "npm: run npm --version"}; ${(python.stdout || python.stderr || "Python 3.11+ required").trim()}`);
}
