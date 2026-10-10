import test from 'node:test';
import assert from 'node:assert/strict';
import { createPullRefresh } from '../features/github/pullRefresh.ts';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('repeated pull gestures share one request and keep the indicator until it settles', async () => {
  const controller = createPullRefresh(); controller.activate();
  const request = deferred(); let calls = 0;
  const task = () => { calls++; return request.promise; };
  const first = controller.run([task]);
  assert.equal(controller.snapshot(), true);
  assert.equal(controller.run([task]), first);
  await Promise.resolve(); assert.equal(calls, 1);
  request.resolve(); await first;
  assert.equal(controller.snapshot(), false);
});

test('refresh waits for parent and child lists even if one fails first', async () => {
  const controller = createPullRefresh(); controller.activate();
  const child = deferred(); let childStarted = false;
  const task = controller.run([async () => { throw new Error('offline'); }, () => { childStarted = true; return child.promise; }]);
  await Promise.resolve(); await Promise.resolve();
  assert.equal(childStarted, true); assert.equal(controller.snapshot(), true);
  child.resolve(); await task; assert.equal(controller.snapshot(), false);
});

test('a synchronous loader failure neither skips other loaders nor leaves a spinner', async () => {
  const controller = createPullRefresh(); controller.activate(); let loaded = false;
  await controller.run([() => { throw new Error('failed before fetching'); }, async () => { loaded = true; }]);
  assert.equal(loaded, true); assert.equal(controller.snapshot(), false);
});

test('an old request cannot clear the new gesture after leaving and returning', async () => {
  const controller = createPullRefresh(); controller.activate();
  const old = deferred(), current = deferred();
  const stale = controller.run([() => old.promise]);
  await Promise.resolve();
  controller.deactivate(); assert.equal(controller.snapshot(), false);
  controller.activate(); const fresh = controller.run([() => current.promise]);
  old.resolve(); await stale; assert.equal(controller.snapshot(), true);
  current.resolve(); await fresh; assert.equal(controller.snapshot(), false);
});

test('inactive pages do not start work; subscribers observe only gesture state changes', async () => {
  const controller = createPullRefresh(); let called = false;
  await controller.run([async () => { called = true; }]); assert.equal(called, false);
  const states = []; const stop = controller.subscribe(() => states.push(controller.snapshot()));
  controller.activate(); await controller.run([async () => {}]);
  assert.deepEqual(states, [true, false]); stop();
  await controller.run([async () => {}]); assert.deepEqual(states, [true, false]);
});

test('leaving before the gesture microtask runs prevents all queued loaders from starting', async () => {
  const controller = createPullRefresh(); controller.activate(); let calls = 0;
  const gesture = controller.run([async () => { calls++; }, async () => { calls++; }]);
  controller.deactivate();
  await gesture;
  assert.equal(calls, 0); assert.equal(controller.snapshot(), false);
});

test('returning before the old microtask runs starts only the new focused gesture', async () => {
  const controller = createPullRefresh(); controller.activate();
  const calls = []; const freshRequest = deferred();
  const old = controller.run([async () => { calls.push('old'); }]);
  controller.deactivate(); controller.activate();
  const fresh = controller.run([() => { calls.push('new'); return freshRequest.promise; }]);
  await old;
  assert.deepEqual(calls, ['new']); assert.equal(controller.snapshot(), true);
  freshRequest.resolve(); await fresh; assert.equal(controller.snapshot(), false);
});

test('blur caused by one loader prevents later queued child loaders from starting', async () => {
  const controller = createPullRefresh(); controller.activate(); let childStarted = false;
  await controller.run([async () => { controller.deactivate(); }, async () => { childStarted = true; }]);
  assert.equal(childStarted, false); assert.equal(controller.snapshot(), false);
});
