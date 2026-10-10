import test from 'node:test';
import assert from 'node:assert/strict';
import { frameworkForFile, frameworkRequirement, runCancellableNativeRequest } from '../features/analysis/frameworks.ts';

const requestId = '0f90bdaf-9a34-4690-9305-80f577dcd811';
function status(java = false, native = false) {
  return { javaAvailable: java, nativeAvailable: native, components: [
    { id: 'java', supported: true, installed: java, version: '1.5.6', downloadBytes: 1000, installedBytes: java ? 2000 : 0 },
    { id: 'native', supported: true, installed: native, version: '6.2.2', downloadBytes: 3000, installedBytes: native ? 4000 : 0 },
  ] };
}

test('file suffixes choose the required component without treating paths or case as another format', () => {
  for (const extension of ['apk', 'dex', 'jar', 'class']) assert.equal(frameworkForFile(`long/path/test.${extension.toUpperCase()}`), 'java');
  for (const extension of ['exe', 'dll', 'sys', 'elf', 'so', 'dylib', 'bin']) assert.equal(frameworkForFile(`test.apk.${extension}`), 'native');
  assert.equal(frameworkForFile('program-without-extension'), null);
});

test('having a native component does not allow Java analysis and vice versa', () => {
  assert.equal(frameworkRequirement(status(false, true), 'app.apk', 'en').ready, false);
  assert.match(frameworkRequirement(status(false, true), 'app.apk', 'en').message, /Download Java/);
  assert.equal(frameworkRequirement(status(true, false), 'library.so', 'en').ready, false);
  assert.match(frameworkRequirement(status(true, false), 'library.so', 'zh').message, /下载/);
});

test('an installed supported component enables only its program type', () => {
  assert.equal(frameworkRequirement(status(true, false), 'test.class', 'en').ready, true);
  assert.equal(frameworkRequirement(status(false, true), 'test.exe', 'en').ready, true);
});

test('unsupported devices get an unsupported explanation rather than a download prompt', () => {
  const value = status(); value.components[0].supported = false;
  const result = frameworkRequirement(value, 'app.apk', 'en');
  assert.equal(result.ready, false);
  assert.match(result.message, /not supported/);
  assert.doesNotMatch(result.message, /Download/);
});

test('unknown extensions defer real format detection to an installed engine without inventing support', () => {
  assert.equal(frameworkRequirement(status(true, false), 'program', 'en').ready, true);
  assert.equal(frameworkRequirement(status(false, true), 'program', 'en').ready, true);
  assert.equal(frameworkRequirement(status(), 'program', 'en').ready, false);
  assert.match(frameworkRequirement(status(), 'program', 'en').message, /Download the required/);
  assert.equal(frameworkRequirement(null, 'program', 'en').ready, false);
});

function operation(overrides = {}) {
  const controller = new AbortController();
  let listener;
  const calls = [], progress = [];
  const input = { requestId, signal: controller.signal,
    subscribe: (value) => { calls.push('subscribe'); listener = value; return { remove: () => calls.push('unsubscribe') }; },
    onProgress: (value) => progress.push(value),
    run: async () => { calls.push('run'); return status(true); },
    cancel: () => calls.push('cancel'), ...overrides };
  return { input, controller, calls, progress, emit: (value) => listener?.(value) };
}

test('a pre-canceled installation does not subscribe, download or cancel another operation', async () => {
  const value = operation(); value.controller.abort();
  await assert.rejects(runCancellableNativeRequest(value.input), { name: 'AbortError' });
  assert.deepEqual(value.calls, []);
});

test('installation progress is owned by request id and disappears immediately after cancellation', async () => {
  let complete;
  const value = operation({ run: () => new Promise((resolve) => { complete = resolve; }) });
  const task = runCancellableNativeRequest(value.input);
  value.emit({ requestId: 'other-request', completed: 1 });
  value.emit({ requestId, completed: 2 });
  value.controller.abort();
  value.emit({ requestId, completed: 3 });
  assert.deepEqual(value.progress, [{ requestId, completed: 2 }]);
  complete(status(true));
  await assert.rejects(task, { name: 'AbortError' });
});

test('canceling an installation keeps its promise pending until native cleanup settles', async () => {
  let complete;
  const value = operation({ run: () => new Promise((resolve) => { complete = resolve; }) });
  const task = runCancellableNativeRequest(value.input);
  let settled = false; void task.then(() => { settled = true; }, () => { settled = true; });
  value.controller.abort();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.deepEqual(value.calls, ['subscribe', 'cancel']);
  complete(status(true));
  await assert.rejects(task, { name: 'AbortError' });
  assert.deepEqual(value.calls, ['subscribe', 'cancel', 'unsubscribe']);
});

test('failed native downloads release progress subscription and do not retain an abort listener', async () => {
  const value = operation({ run: async () => { throw new Error('Hash verification failed'); } });
  await assert.rejects(runCancellableNativeRequest(value.input), /Hash verification failed/);
  value.controller.abort();
  assert.deepEqual(value.calls, ['subscribe', 'unsubscribe']);
});

test('a completed native installation returns its real status and later abort cannot cancel it', async () => {
  const value = operation();
  assert.deepEqual(await runCancellableNativeRequest(value.input), status(true));
  value.controller.abort();
  assert.deepEqual(value.calls, ['subscribe', 'run', 'unsubscribe']);
});

test('cancellation during listener setup cannot start a native download', async () => {
  const value = operation();
  value.input.subscribe = () => { value.controller.abort(); return { remove: () => value.calls.push('unsubscribe') }; };
  await assert.rejects(runCancellableNativeRequest(value.input), { name: 'AbortError' });
  assert.deepEqual(value.calls, ['unsubscribe']);
});
