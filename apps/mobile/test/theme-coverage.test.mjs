import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { darkColor } from "../features/theme/theme.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("every hex used by the app maps to a valid, different dark colour", () => {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", "android", "dist", "theme"].includes(entry.name)) walk(full);
      } else if (/\.tsx?$/u.test(entry.name) && entry.name !== "uiTestFixtures.ts") files.push(full);
    }
  };
  for (const dir of ["components", "src", "features"]) walk(path.join(root, dir));
  const seen = new Set();
  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/themed\(['"](#[0-9a-fA-F]{3,6})['"]\)/gu)) seen.add(match[1].toLowerCase());
  }
  assert.ok(seen.size > 50);
  for (const hex of seen) assert.match(darkColor(hex), /^#[0-9a-f]{6}$/u, hex);
});

test("screens never hard-code a light-only colour outside the theme module", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", "android", "dist", "theme"].includes(entry.name)) walk(full);
        continue;
      }
      if (!/\.tsx?$/u.test(entry.name) || entry.name === "uiTestFixtures.ts") continue;
      fs.readFileSync(full, "utf8")
        .split("\n")
        .forEach((line, index) => {
          for (const match of line.matchAll(/#[0-9a-fA-F]{3,8}\b/gu)) {
            const before = line.slice(Math.max(0, match.index - 8), match.index);
            if (match[0].length === 9 || /themed\(['"]$/u.test(before)) continue;
            offenders.push(`${path.relative(root, full)}:${index + 1} ${match[0]}`);
          }
        });
    }
  };
  for (const dir of ["components", "src", "features"]) walk(path.join(root, dir));
  assert.deepEqual(offenders, []);
});
