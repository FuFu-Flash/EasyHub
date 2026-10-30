import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const prettierRoots = [
  { dir: "apps/desktop/src/renderer", extensions: new Set([".ts", ".tsx", ".css", ".html", ".json"]) },
  { dir: "apps/mobile/components", extensions: new Set([".ts", ".tsx", ".cjs", ".mjs"]) },
  { dir: "apps/mobile/src", extensions: new Set([".ts", ".tsx", ".cjs", ".mjs"]) },
  { dir: "apps/mobile/features", extensions: new Set([".ts", ".tsx", ".cjs", ".mjs"]) },
  { dir: "apps/mobile/plugins", extensions: new Set([".ts", ".tsx", ".cjs", ".mjs"]) },
  { dir: "apps/mobile/test", extensions: new Set([".ts", ".tsx", ".cjs", ".mjs"]) },
];

function filesPrettierChecks() {
  const files = [];
  const visit = (dir, extensions) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full, extensions);
      else if (extensions.has(path.extname(entry.name)))
        files.push(path.relative(repo, full).split(path.sep).join("/"));
    }
  };
  for (const root of prettierRoots) visit(path.join(repo, root.dir), root.extensions);
  return files;
}

test("the repository format check covers the Android app and keeps its existing double-quote style", () => {
  const desktop = JSON.parse(fs.readFileSync(path.join(repo, "apps/desktop/package.json"), "utf8"));
  for (const script of ["format", "format:check"])
    assert.match(desktop.scripts[script], /\.\.\/mobile\/\{components,src,features,plugins,test\}/u);
  const prettier = JSON.parse(fs.readFileSync(path.join(repo, ".prettierrc.json"), "utf8"));
  assert.equal(prettier.singleQuote, true);
  assert.equal(prettier.endOfLine, "lf");
  assert.deepEqual(prettier.overrides, [{ files: "apps/mobile/**", options: { singleQuote: false } }]);
});

test("files Prettier checks stay LF when Windows checks them out", () => {
  const files = filesPrettierChecks();
  assert.ok(files.length > 160, `expected the mobile and desktop format set, got ${files.length}`);
  const unspecified = [];
  for (let index = 0; index < files.length; index += 80) {
    const output = execFileSync("git", ["check-attr", "eol", "--", ...files.slice(index, index + 80)], {
      cwd: repo,
      encoding: "utf8",
    });
    for (const line of output.split("\n")) {
      if (line && !line.endsWith(": eol: lf")) unspecified.push(line);
    }
  }
  assert.deepEqual(unspecified, []);
});
