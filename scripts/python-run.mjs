import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const local = path.join(root, "..", ".castoriceui-venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const interpreter = process.env.CASTORICEUI_PYTHON || (existsSync(local) ? local : process.platform === "win32" ? "python" : "python3");
const result = spawnSync(interpreter, process.argv.slice(2), { stdio: "inherit", cwd: root });
if (result.error) process.stderr.write("Python could not be started. Create ../.castoriceui-venv and install server/requirements.txt.\n");
process.exit(result.status ?? 1);
