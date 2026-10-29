import test from "node:test";
import assert from "node:assert/strict";
import { createNoticeTimer } from "../features/workspace/noticeTimer.ts";

function fixture() {
  let now = 0;
  let expired = 0;
  let sequence = 0;
  const pending = new Map();
  const clock = {
    now: () => now,
    schedule: (callback, delay) => {
      const id = ++sequence;
      pending.set(id, { callback, deadline: now + delay });
      return id;
    },
    cancel: (id) => pending.delete(id),
  };
  const advance = (milliseconds) => {
    now += milliseconds;
    for (const [id, item] of pending)
      if (item.deadline <= now) {
        pending.delete(id);
        item.callback();
      }
  };
  return {
    timer: createNoticeTimer(
      () => {
        expired++;
      },
      4000,
      clock,
    ),
    advance,
    expired: () => expired,
    pending,
  };
}

test("a success message stays visible for four seconds and expires once", () => {
  const f = fixture();
  f.advance(3999);
  assert.equal(f.expired(), 0);
  f.advance(1);
  assert.equal(f.expired(), 1);
  f.timer.release("focus");
  f.advance(9000);
  assert.equal(f.expired(), 1);
});

test("hover, touch, focus and background each pause the remaining time independently", () => {
  const f = fixture();
  f.advance(1200);
  for (const reason of ["hover", "touch", "focus", "background"]) f.timer.pause(reason);
  f.advance(20000);
  for (const reason of ["hover", "touch", "focus"]) {
    f.timer.release(reason);
    f.advance(10000);
  }
  assert.equal(f.expired(), 0);
  f.timer.release("background");
  f.advance(2799);
  assert.equal(f.expired(), 0);
  f.advance(1);
  assert.equal(f.expired(), 1);
});

test("repeated pause calls do not shorten or extend a success message", () => {
  const f = fixture();
  f.advance(1000);
  f.timer.pause("focus");
  f.advance(2000);
  f.timer.pause("focus");
  f.timer.release("focus");
  f.advance(2999);
  assert.equal(f.expired(), 0);
  f.advance(1);
  assert.equal(f.expired(), 1);
});

test("screen-reader users can read feedback until they choose to dismiss it", () => {
  const f = fixture();
  f.timer.pause("screen-reader");
  f.advance(3600000);
  assert.equal(f.expired(), 0);
  f.timer.dispose();
  assert.equal(f.pending.size, 0);
});

test("leaving the page or replacing a message disposes the previous deadline", () => {
  const old = fixture();
  old.advance(3500);
  old.timer.dispose();
  old.timer.release("focus");
  old.advance(4000);
  assert.equal(old.expired(), 0);
  const next = fixture();
  next.advance(3999);
  assert.equal(next.expired(), 0);
  next.advance(1);
  assert.equal(next.expired(), 1);
});

test("a canceled callback already queued before pause cannot expire a resumed notice", () => {
  const f = fixture();
  const stale = [...f.pending.values()][0].callback;
  f.advance(1000);
  f.timer.pause("focus");
  f.timer.release("focus");
  stale();
  assert.equal(f.expired(), 0);
  f.advance(2999);
  assert.equal(f.expired(), 0);
  f.advance(1);
  assert.equal(f.expired(), 1);
});
