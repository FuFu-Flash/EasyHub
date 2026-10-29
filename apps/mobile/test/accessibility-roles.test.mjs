import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sources() {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!["node_modules", "android", "dist"].includes(entry.name)) walk(full);
      } else if (entry.name.endsWith(".tsx")) files.push(full);
    }
  };
  for (const dir of ["components", "src", "features"]) walk(path.join(root, dir));
  return files;
}

test("every pressable declares an accessibility role so screen readers announce it as something to tap", () => {
  const missing = [];
  for (const file of sources()) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const visit = (node) => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(source) === "Pressable"
      ) {
        const names = node.attributes.properties.map((property) =>
          ts.isJsxAttribute(property) ? property.name.getText(source) : "...",
        );
        if (!names.includes("accessibilityRole") && !names.includes("...")) {
          missing.push(
            `${path.relative(root, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`,
          );
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(missing, []);
});

function opening(file, predicate) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const found = [];
  const visit = (node) => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && predicate(node, source)) {
      found.push(
        Object.fromEntries(
          node.attributes.properties
            .filter(ts.isJsxAttribute)
            .map((attribute) => [attribute.name.getText(source), attribute.initializer?.getText(source) ?? "true"]),
        ),
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const attribute = (node, source, name) =>
  node.attributes.properties.find((property) => property.name?.getText(source) === name);

test("the project section tabs are tabs with a selected state and the alert backdrop is a labelled button", () => {
  const project = path.join(root, "src/app/project/[owner]/[repo]/index.tsx");
  const tablist = opening(
    project,
    (node, source) => node.tagName.getText(source) === "ScrollView" && !!attribute(node, source, "accessibilityRole"),
  );
  assert.equal(tablist[0].accessibilityRole, '"tablist"');
  const tabs = opening(
    project,
    (node, source) =>
      node.tagName.getText(source) === "Pressable" &&
      attribute(node, source, "accessibilityRole")?.initializer?.getText(source) === '"tab"',
  );
  assert.equal(tabs.length, 1);
  assert.match(tabs[0].accessibilityState.replace(/\s+/gu, " "), /selected: section === id/u);
  const backdrop = opening(
    path.join(root, "components/AppAlert.tsx"),
    (node, source) =>
      node.tagName.getText(source) === "Pressable" &&
      attribute(node, source, "onPress")?.initializer?.getText(source) === "{dismiss}",
  );
  assert.equal(backdrop[0].accessibilityRole, '"button"');
  assert.match(backdrop[0].accessibilityLabel, /AppAlert\.closeDialog/u);
});
