import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareProgramReview, runProgramReview } from '../features/analysis/programReview.ts';

const file = { uri: 'content://documents/program.exe', name: 'program.exe', size: 1024 };
const settings = { providerId: 'openai', model: 'model-for-review', apiKey: 'private-test-key' };
const requestId = '5ac74cfa-81f0-4de6-ac4b-c50632a1b0bd';
const evidence = () => ({ id: requestId, fileName: file.name, size: file.size, sha256: 'a'.repeat(64), format: 'PE', architecture: 'x86 64-bit', functionCount: 1,
  functions: [{ name: 'main', address: '0x140001000', code: 'int main() { return 0; }' }], imports: [], strings: [], summary: 'Sampled evidence', limitations: ['Sampled only'] });
function fixture(overrides = {}) {
  const calls = [];
  const services = {
    loadSettings: async () => { calls.push('settings'); return { ...settings }; },
    analyze: async (input, signal, progress) => { calls.push('extract'); progress({ requestId, phase: 'analyzing', completed: 1, total: 1, message: 'main', unit: 'steps' }); return evidence(); },
    review: async (input) => { calls.push('review'); assert.equal(input.consentToSend, true); assert.equal(input.providerBaseUrl, 'https://api.openai.com/v1'); return { analysisId: input.analysis.id, summary: 'No issue supported.', findings: [], limitations: [] }; },
    ...overrides,
  };
  return { calls, services };
}
async function input(services, extra = {}) {
  return { requestId, prepared: await prepareProgramReview(file, 'en', services), language: 'en', consentToSend: true, signal: new AbortController().signal, ...extra };
}

test('preparing the confirmation neither extracts nor sends a file and holds an immutable selection', async () => {
  const { calls, services } = fixture();
  const selection = { ...file };
  const prepared = await prepareProgramReview(selection, 'en', services);
  selection.name = 'other.exe';
  assert.deepEqual(calls, ['settings']);
  assert.equal(prepared.file.name, file.name);
  assert.equal(Object.isFrozen(prepared.file), true);
  assert.equal(Object.isFrozen(prepared.settings), true);
});

test('one confirmation performs extraction then AI with the same signal, file identity and fresh credentials', async () => {
  const { calls, services } = fixture();
  const original = services.analyze;
  const controller = new AbortController();
  services.analyze = async (value, signal, progress) => {
    assert.deepEqual(value, { requestId, uri: file.uri, name: file.name, language: 'en', expectedSize: 1024 });
    assert.equal(signal, controller.signal);
    return original(value, signal, progress);
  };
  const progress = [], stages = [], extracted = [];
  const result = await runProgramReview(await input(services, { signal: controller.signal, onProgress: (value) => progress.push(value), onStage: (stage) => stages.push(stage), onAnalysis: (value) => extracted.push(value) }), services);
  assert.deepEqual(calls, ['settings', 'settings', 'extract', 'settings', 'review']);
  assert.deepEqual(stages, ['extracting', 'reviewing']);
  assert.equal(progress[0].requestId, requestId);
  assert.equal(extracted[0].id, result.review.analysisId);
});

test('without consent no extraction or AI starts', async () => {
  const { calls, services } = fixture();
  const request = await input(services, { consentToSend: false });
  await assert.rejects(runProgramReview(request, services), /确认/);
  assert.deepEqual(calls, ['settings']);
});

for (const changed of [{ ...settings, providerId: 'deepseek' }, { ...settings, model: 'changed' }, { ...settings, apiKey: 'different-private-key' }, null]) {
  test(`changed ${changed ? Object.keys(changed).find((key) => changed[key] !== settings[key]) : 'removed authorization'} requires confirmation before extracting`, async () => {
    const { calls, services } = fixture();
    const request = await input(services);
    services.loadSettings = async () => changed;
    await assert.rejects(runProgramReview(request, services), /settings changed|Connect your AI/);
    assert.deepEqual(calls, ['settings']);
  });
}

test('a destination mismatch never starts extraction', async () => {
  const { calls, services } = fixture();
  const request = await input(services);
  await assert.rejects(runProgramReview({ ...request, prepared: { ...request.prepared, providerBaseUrl: 'https://different.example' } }, services), /settings changed/);
  assert.ok(!calls.includes('extract'));
});

test('authorization changed during extraction preserves local evidence and prevents sending it', async () => {
  const { calls, services } = fixture();
  const recovered = [];
  services.analyze = async () => { calls.push('extract'); services.loadSettings = async () => ({ ...settings, apiKey: 'replacement-key' }); return evidence(); };
  await assert.rejects(runProgramReview(await input(services, { onAnalysis: (value) => recovered.push(value) }), services), /settings changed/);
  assert.equal(recovered[0].id, requestId);
  assert.ok(!calls.includes('review'));
});

test('pre-cancelled review does no further work', async () => {
  const { calls, services } = fixture();
  const controller = new AbortController();
  const request = await input(services, { signal: controller.signal });
  controller.abort();
  await assert.rejects(runProgramReview(request, services), { name: 'AbortError' });
  assert.deepEqual(calls, ['settings']);
});

test('cancellation waits for extraction to settle and never sends recovered evidence', async () => {
  const { calls, services } = fixture();
  const controller = new AbortController();
  let finish, started;
  const ready = new Promise((resolve) => { started = resolve; });
  services.analyze = async () => { calls.push('extract'); started(); return await new Promise((resolve) => { finish = resolve; }); };
  const task = runProgramReview(await input(services, { signal: controller.signal }), services);
  await ready; controller.abort();
  let settled = false;
  void task.then(() => { settled = true; }, () => { settled = true; });
  await Promise.resolve(); assert.equal(settled, false);
  finish(evidence());
  await assert.rejects(task, { name: 'AbortError' });
  assert.ok(!calls.includes('review'));
});

test('cancelled AI cannot return a completed result', async () => {
  const { services } = fixture();
  const controller = new AbortController();
  services.review = async () => { controller.abort(); return { analysisId: requestId, summary: 'Late reply', findings: [], limitations: [] }; };
  await assert.rejects(runProgramReview(await input(services, { signal: controller.signal }), services), { name: 'AbortError' });
});

for (const mismatch of [{ id: 'old-evidence' }, { fileName: 'other.exe' }, { size: 1023 }]) {
  test(`mismatched extraction ${Object.keys(mismatch)[0]} cannot be sent`, async () => {
    const { calls, services } = fixture({ analyze: async () => ({ ...evidence(), ...mismatch }) });
    await assert.rejects(runProgramReview(await input(services), services), /does not match/);
    assert.ok(!calls.includes('review'));
  });
}

test('AI result must correspond to the extracted evidence', async () => {
  const { services } = fixture({ review: async () => ({ analysisId: 'old-report', summary: 'Old result', findings: [], limitations: [] }) });
  await assert.rejects(runProgramReview(await input(services), services), /does not match/);
});

test('extraction failure does not invoke AI; provider failure preserves recovered evidence', async () => {
  const first = fixture({ analyze: async () => { throw new Error('Cannot extract'); } });
  await assert.rejects(runProgramReview(await input(first.services), first.services), /Cannot extract/);
  assert.ok(!first.calls.includes('review'));
  const recovered = [];
  const second = fixture({ review: async () => { throw new Error('Provider unavailable'); } });
  await assert.rejects(runProgramReview(await input(second.services, { onAnalysis: (value) => recovered.push(value) }), second.services), /Provider unavailable/);
  assert.equal(recovered[0].id, requestId);
});

test('unknown SAF length is inspected by the engine without inventing a size', async () => {
  const { services } = fixture();
  services.analyze = async (value) => { assert.equal('expectedSize' in value, false); return evidence(); };
  const prepared = await prepareProgramReview({ ...file, size: null }, 'en', services);
  const result = await runProgramReview({ requestId, prepared, language: 'en', consentToSend: true, signal: new AbortController().signal }, services);
  assert.equal(result.analysis.size, 1024);
});

test('unreadable, empty or oversized files and missing authorization fail before preparation', async () => {
  const { services } = fixture();
  for (const value of [{ ...file, uri: 'https://untrusted.example/app.exe' }, { ...file, size: 0 }, { ...file, size: 128 * 1024 * 1024 + 1 }]) {
    await assert.rejects(prepareProgramReview(value, 'en', services), /readable/);
  }
  await assert.rejects(prepareProgramReview(file, 'en', { loadSettings: async () => null }), /Connect your AI/);
});
