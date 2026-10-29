import test from "node:test";
import assert from "node:assert/strict";
import {
  createProgramReviewNoticeStore,
  missingProgramReviewComponents,
  parseProgramReviewNoticesEnabled,
} from "../features/analysis/programReviewNotice.ts";

test("component reminders default on and preserve an explicit disabled choice across sessions", () => {
  let value = null;
  const storage = {
    read: () => value,
    write: (next) => {
      value = next;
    },
  };
  const first = createProgramReviewNoticeStore(storage);
  assert.equal(first.snapshot(), true);
  first.set(false);
  assert.equal(createProgramReviewNoticeStore(storage).snapshot(), false);
  first.set(true);
  assert.equal(createProgramReviewNoticeStore(storage).snapshot(), true);
  for (const malformed of [null, undefined, false, "{}", "FALSE"])
    assert.equal(parseProgramReviewNoticesEnabled(malformed), true);
});

test("all mounted entry points observe changes while unavailable storage retains the session choice", () => {
  const store = createProgramReviewNoticeStore({
    read: () => {
      throw Error("unavailable");
    },
    write: () => {
      throw Error("full");
    },
  });
  const seen = [];
  const unsubscribe = store.subscribe(() => seen.push(store.snapshot()));
  store.set(false);
  store.set(false);
  store.set(true);
  unsubscribe();
  store.set(false);
  assert.deepEqual(seen, [false, true]);
  assert.equal(store.snapshot(), false);
});

test("empty or deleted programs do not prompt and unsupported or installed engines are never requested", () => {
  const java = { id: "java", supported: true, installed: false };
  const native = { id: "native", supported: true, installed: false };
  const file = { filename: "app.apk", status: "added", sha: "a".repeat(40), additions: 0, deletions: 0 };
  assert.deepEqual(missingProgramReviewComponents([file], [java, native]), [java]);
  for (const change of [
    { sha: "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391" },
    { status: "removed" },
    { patch: "text diff" },
  ]) {
    assert.deepEqual(missingProgramReviewComponents([{ ...file, ...change }], [java, native]), []);
  }
  assert.deepEqual(missingProgramReviewComponents([file], [{ ...java, installed: true }, native]), []);
  assert.deepEqual(missingProgramReviewComponents([file], [{ ...java, supported: false }, native]), []);
});
