import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const luminance = (hex) => {
  const rgb = hex.match(/[a-f0-9]{2}/gi).map((part) => parseInt(part, 16) / 255)
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};

for (const family of ["teal", "cyan", "indigo", "coral", "slate"]) {
  test(`${family} dark foregrounds meet 4.5:1 contrast on their containers`, () => {
    const selector = `:root[data-theme="dark"][data-theme-color="${family}"]`;
    const block = styles.slice(styles.indexOf(selector)).split("}")[0];
    const colors = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[a-f0-9]{6})/gi)].map((match) => [match[1], match[2]]));
    for (const role of ["primary", "secondary", "tertiary", "primary-container", "secondary-container", "tertiary-container"]) {
      assert.ok(colors[role] && colors[`on-${role}`], `${family} must pair ${role} with its foreground`);
      const values = [luminance(colors[role]), luminance(colors[`on-${role}`])];
      const ratio = (Math.max(...values) + .05) / (Math.min(...values) + .05);
      assert.ok(ratio >= 4.5, `${family} ${role} contrast is ${ratio.toFixed(2)}:1`);
    }
  });
}
