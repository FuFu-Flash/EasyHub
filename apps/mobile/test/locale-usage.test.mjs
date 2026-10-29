import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zh } from "../features/localization/locales/zh.ts";
import { en } from "../features/localization/locales/en.ts";

// Catalog entries that only the translator tests exercise (plural forms, interpolation and typed errors).
const translatorFixtures = new Set(["common.reload", "common.fileCount", "common.commentCount", "common.itemOfTotal"]);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function source() {
  const chunks = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", "android", "dist", "locales"].includes(entry.name)) walk(full);
      } else if (/\.(tsx?|cjs|mjs)$/u.test(entry.name)) chunks.push(fs.readFileSync(full, "utf8"));
    }
  };
  for (const dir of ["components", "src", "features", "plugins"]) walk(path.join(root, dir));
  return chunks.join("\n");
}

test("every interface message is used by the app, so retired screens do not leave text behind", () => {
  const code = source();
  const unused = Object.keys(zh).filter(
    (key) =>
      !translatorFixtures.has(key) &&
      !code.includes(`"${key}"`) &&
      !code.includes(`'${key}'`) &&
      !code.includes(`\`${key}\``),
  );
  assert.deepEqual(unused, []);
});

test("a message key with a generated hash suffix must say something its plain key does not", () => {
  const duplicates = Object.keys(zh).filter((key) => {
    const base = key.replace(/(?<=[A-Za-z])[0-9a-f]{8}$/u, "");
    return base !== key && base in zh && zh[base] === zh[key] && JSON.stringify(en[base]) === JSON.stringify(en[key]);
  });
  assert.deepEqual(duplicates, []);
});
