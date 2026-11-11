import assert from "node:assert/strict";
import test from "node:test";
import { readStyles } from "./style-source.mjs";

const styles = await readStyles(new URL("../", import.meta.url));
const luminance = (hex) => {
  const rgb = hex.match(/[a-f0-9]{2}/gi).map((part) => parseInt(part, 16) / 255)
    .map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
};

function palette(selector) {
  const blocks = styles.split(`${selector} {`).slice(1).map((block) => block.split("}")[0]);
  assert.ok(blocks.length, selector);
  return Object.fromEntries(blocks.flatMap((block) => [...block.matchAll(/--([\w-]+):\s*(#[a-f0-9]{6})/gi)].map((match) => [match[1], match[2]])));
}

function checkPair(colors, foreground, background, minimum = 4.5) {
  assert.ok(colors[foreground] && colors[background], `${foreground} and ${background} must be defined`);
  const values = [luminance(colors[foreground]), luminance(colors[background])];
  const ratio = (Math.max(...values) + .05) / (Math.min(...values) + .05);
  assert.ok(ratio >= minimum, `${foreground} on ${background} is ${ratio.toFixed(2)}:1`);
}

for (const family of ["violet", "blue", "green", "rose", "amber", "teal", "cyan", "indigo", "coral", "slate"]) {
  const familySelector = `[data-theme-color="${family}"]`;
  const light = { ...palette(":root"), ...(family === "violet" ? {} : palette(`:root${familySelector}`)) };
  const dark = { ...light, ...palette(':root[data-theme="dark"]'), ...(family === "violet" ? {} : palette(`:root[data-theme="dark"]${familySelector}`)) };
  for (const [mode, colors] of [["light", light], ["dark", dark]]) {
    test(`${family} ${mode} text and chart roles retain readable contrast`, () => {
      for (const role of ["primary", "secondary", "tertiary", "primary-container", "secondary-container", "tertiary-container", "error", "error-container", "warning-container", "success-container", "info-container", "surface"]) {
        checkPair(colors, `on-${role}`, role);
      }
      checkPair(colors, "on-surface", "surface-container-high");
      checkPair(colors, "on-surface-variant", "surface-container-high");
      checkPair(colors, "inverse-on-surface", "inverse-surface");
      for (const role of ["primary", "warning", "success", "error"]) checkPair(colors, role, "surface-container-low");
      for (const role of ["chart-primary", "chart-secondary", "chart-tertiary", "chart-muted"]) checkPair(colors, role, "surface-container-high", 3);
    });
  }
}
