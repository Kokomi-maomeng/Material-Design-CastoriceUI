import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export async function checkDocLinks(root) {
  const files = (await readdir(root)).filter((name) => name.endsWith(".md")).map((name) => path.join(root, name));
  for (const name of await readdir(path.join(root, "docs"))) if (name.endsWith(".md")) files.push(path.join(root, "docs", name));
  for (const file of files) {
    for (const match of (await readFile(file, "utf8")).matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split(/\s+"/)[0].replace(/^<|>$/g, "").split("#")[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(target));
      if (path.relative(root, resolved).startsWith("..")) throw new Error(`Documentation link escapes root: ${path.basename(file)}`);
      try { await stat(resolved); } catch { throw new Error(`Missing documentation target in ${path.basename(file)}: ${target}`); }
    }
  }
}
