import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("the repository format check covers the Android app and keeps its existing double-quote style", () => {
  const desktop = JSON.parse(fs.readFileSync(path.join(repo, "apps/desktop/package.json"), "utf8"));
  for (const script of ["format", "format:check"])
    assert.match(desktop.scripts[script], /\.\.\/mobile\/\{components,src,features,plugins,test\}/u);
  const prettier = JSON.parse(fs.readFileSync(path.join(repo, ".prettierrc.json"), "utf8"));
  assert.equal(prettier.singleQuote, true);
  assert.deepEqual(prettier.overrides, [{ files: "apps/mobile/**", options: { singleQuote: false } }]);
});
