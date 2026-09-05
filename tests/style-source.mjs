import { readFile } from "node:fs/promises";

const styleModules = [
  "app/styles/foundations.css",
  "app/styles/onboarding.css",
  "app/styles/themes.css",
  "app/styles/account-settings.css",
  "app/styles/interactions.css",
  "app/styles/charts.css",
  "app/styles/quota.css",
  "app/styles/setup.css",
  "app/styles/services.css",
];

export async function readStyles(root) {
  return (await Promise.all(styleModules.map((path) => readFile(new URL(path, root), "utf8")))).join("\n");
}

export { styleModules };
