import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createPagedList } from "../features/github/pagedList.ts";

const require = createRequire(new URL("../package.json", import.meta.url));
const ts = require("typescript");
const source = fs.readFileSync(new URL("../features/github/usePagedList.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const focusSource = fs.readFileSync(new URL("../features/auth/useSessionReadFocusEffect.ts", import.meta.url), "utf8");
const focusCompiled = ts.transpileModule(focusSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const flush = async () => {
  for (let index = 0; index < 3; index++) await new Promise((resolve) => setImmediate(resolve));
};

test("connection recovery revalidates the real list hook without clearing its opened pages", async () => {
  const slots = [];
  let cursor = 0;
  let revision = 0;
  let focused;
  let cleanup;
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const memo = (factory, deps) => {
    const index = cursor++;
    if (!slots[index] || !equal(slots[index].deps, deps)) slots[index] = { value: factory(), deps };
    return slots[index].value;
  };
  const mocks = {
    react: {
      useMemo: memo,
      useCallback: (callback, deps) => memo(() => callback, deps),
      useState: (initial) => {
        const index = cursor++;
        slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
        return [
          slots[index].value,
          (value) => {
            slots[index].value = typeof value === "function" ? value(slots[index].value) : value;
          },
        ];
      },
    },
    "expo-router": {
      useFocusEffect: (callback) => {
        if (callback !== focused) {
          cleanup?.();
          focused = callback;
          cleanup = callback();
        }
      },
    },
    "./session": { useSession: () => ({ readRevision: revision }) },
    "./pagedList": { createPagedList },
  };
  const focusModule = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${focusCompiled}\n})`)(
    (id) => {
      if (!Object.hasOwn(mocks, id)) throw Error(`Unexpected focus hook import: ${id}`);
      return mocks[id];
    },
    focusModule,
    focusModule.exports,
  );
  mocks["../auth/useSessionReadFocusEffect"] = focusModule.exports;
  const module = { exports: {} };
  vm.runInThisContext(`(function(require,module,exports){${compiled}\n})`)(
    (id) => {
      if (!Object.hasOwn(mocks, id)) throw Error(`Unexpected list hook import: ${id}`);
      return mocks[id];
    },
    module,
    module.exports,
  );
  const calls = [];
  const last = deferred();
  let updated = false;
  const fetchPage = async (page) => {
    calls.push(page);
    if (updated && page === 2) return last.promise;
    return { items: [{ id: page, title: `${updated ? "new" : "old"} ${page}` }], nextPage: page + 1 };
  };
  const itemKey = (item) => item.id;
  const render = () => {
    cursor = 0;
    return module.exports.usePagedList(fetchPage, itemKey, true);
  };
  render();
  await flush();
  await render().more();
  const opened = render();
  assert.deepEqual(
    opened.items.map((item) => item.title),
    ["old 1", "old 2"],
  );
  revision += 1;
  updated = true;
  render();
  await flush();
  const refreshing = render();
  assert.equal(refreshing.more, opened.more);
  assert.equal(refreshing.busy, true);
  assert.deepEqual(
    refreshing.items.map((item) => item.title),
    ["old 1", "old 2"],
  );
  assert.deepEqual(calls, [1, 2, 1, 2]);
  last.resolve({ items: [{ id: 2, title: "new 2" }], nextPage: 3 });
  await flush();
  const recovered = render();
  assert.deepEqual(
    recovered.items.map((item) => item.title),
    ["new 1", "new 2"],
  );
  assert.equal(recovered.nextPage, 3);
  assert.equal(recovered.busy, false);
  cleanup();
});
