import assert from 'node:assert/strict';
import test from 'node:test';
import { applyRepositorySetting, assertDeletionAccount, canContributeFork, canForkRepository, canManageRepository, createRepositoryFork, findExistingFork, isValidContributionBranch, loadForkComparison, loadProtectionState, submitForkContribution, waitForForkReady } from '../features/github/repositoryOperations.ts';
import { requestDeletionDeviceCode } from '../features/auth/deviceFlow.ts';

const repository = (extra = {}) => ({ id: 1, name: 'project', full_name: 'alice/project', owner: { login: 'alice' }, default_branch: 'main', private: false, archived: false, description: null, updated_at: '', open_issues_count: 0, permissions: { admin: true, push: true, pull: true }, ...extra });
const upstream = repository({ id: 20, name: 'original', full_name: 'author/original', owner: { login: 'author' }, default_branch: 'develop' });
const fork = repository({ fork: true, parent: { ...upstream, html_url: 'https://github.com/author/original' } });
const identity = async () => ({ login: 'alice' });
const notFound = () => Object.assign(new Error('Not found'), { status: 404 });
const contributor = (extra = {}) => ({ repo: async (owner) => owner === 'author' ? upstream : fork, user: identity, branch: async (_owner, _repo, name) => ({ name, protected: false }), compare: async () => ({ ahead_by: 2, behind_by: 1, status: 'ahead', total_commits: 2, files: [] }), openPullRequestForHead: async () => [], ...extra });

test('public browsing and explicit denied permissions cannot manage or contribute', () => {
  assert.equal(canManageRepository(repository(), 'alice', true), false);
  assert.equal(canManageRepository(repository({ permissions: { admin: false, push: false, pull: true } }), 'alice'), false);
  assert.equal(canManageRepository(repository({ permissions: undefined }), 'ALICE'), true);
  assert.equal(canContributeFork(fork, 'alice', true), false);
  assert.equal(canContributeFork({ ...fork, archived: true }, 'alice'), false);
  assert.equal(canContributeFork(fork, 'other'), false);
  assert.equal(canForkRepository(upstream, 'alice'), true);
  for (const extra of [{ archived: true }, { private: true }, { allow_forking: false }]) assert.equal(canForkRepository({ ...upstream, ...extra }, 'alice'), false);
});

test('fork discovery verifies parent IDs and ignores other owners', async () => {
  const unrelated = repository({ id: 2, name: 'unrelated', fork: true });
  const calls = [];
  const client = { repos: async () => [repository({ id: 3, fork: true, owner: { login: 'other' } }), unrelated, fork], repo: async (_owner, name) => { calls.push(name); return name === 'unrelated' ? { ...unrelated, parent: { id: 99 } } : fork; } };
  assert.equal((await findExistingFork(client, upstream, 'alice')).id, fork.id);
  assert.deepEqual(calls, ['unrelated', 'project']);
});

test('fork readiness waits for the matching parent and handles GitHub 202 propagation', async () => {
  let reads = 0;
  const client = { repo: async () => { reads++; if (reads === 1) throw notFound(); return reads === 2 ? { ...fork, parent: undefined } : fork; } };
  assert.equal((await waitForForkReady(client, fork, upstream, 'alice', undefined, 3, 0)).id, 1);
  assert.equal(reads, 3);
  assert.equal(await waitForForkReady({ repo: async () => ({ ...fork, parent: undefined }) }, fork, upstream, 'alice', undefined, 1, 0), null);
  await assert.rejects(() => waitForForkReady({ repo: async () => ({ ...fork, id: 999 }) }, fork, upstream, 'alice', undefined, 1, 0), /已变化/);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(() => waitForForkReady(client, fork, upstream, 'alice', cancelled.signal, 1, 0), /Aborted/);
});

test('creating a fork checks current permissions and reuses a renamed existing fork', async () => {
  let writes = 0;
  const client = { user: identity, repo: async (owner) => owner === 'author' ? upstream : fork, repos: async () => [fork], createFork: async () => { writes++; return fork; } };
  assert.equal((await createRepositoryFork(client, upstream, 'new-name')).fork.id, fork.id);
  assert.equal(writes, 0);
  await assert.rejects(() => createRepositoryFork({ ...client, repo: async () => ({ ...upstream, allow_forking: false }) }, upstream, 'new-name'), /不允许/);
  await assert.rejects(() => createRepositoryFork(client, upstream, '..'), /有效/);
});

test('comparison uses the live upstream default branch and the exact fork head', async () => {
  const calls = [];
  const result = await loadForkComparison(contributor({ repo: async (owner) => owner === 'author' ? { ...upstream, default_branch: 'trunk' } : fork, compare: async (...args) => { calls.push(args); return { ahead_by: 2 }; }, openPullRequestForHead: async (...args) => { calls.push(args); return []; } }), fork);
  assert.deepEqual(calls, [['author', 'original', 'trunk', 'alice', 'main'], ['author', 'original', 'alice', 'main', 'trunk']]);
  assert.equal(result.fork.parent.default_branch, 'trunk');
});

test('contribution reuses an open request and blocks empty, archived or public submissions', async () => {
  const request = { id: 9, number: 3, html_url: 'https://github.com/author/original/pull/3' };
  let writes = 0;
  const client = contributor({ createPullRequest: async () => { writes++; return request; }, openPullRequestForHead: async () => [request] });
  assert.equal((await submitForkContribution(client, fork, 'Improve it', '')).id, request.id);
  assert.equal(writes, 0);
  await assert.rejects(() => submitForkContribution({ ...client, compare: async () => ({ ahead_by: 0 }) }, fork, 'Improve it', ''), /没有可提交/);
  await assert.rejects(() => submitForkContribution({ ...client, repo: async (owner) => owner === 'author' ? { ...upstream, archived: true } : fork }, fork, 'Improve it', ''), /无法接收/);
  await assert.rejects(() => submitForkContribution(client, fork, 'Improve it', '', true), /可写仓库副本/);
  assert.equal(writes, 0);
});

test('contribution creates a pull request against the validated upstream branch', async () => {
  const calls = [];
  await submitForkContribution(contributor({ createPullRequest: async (...args) => { calls.push(args); return { id: 7 }; } }), fork, '  Fix behavior  ', ' Why ');
  assert.deepEqual(calls, [['author', 'original', { title: 'Fix behavior', body: 'Why', head: 'alice:main', base: 'develop' }]]);
});

test('contribution branch names accept nested and Unicode names but exclude Git revision syntax', async () => {
  for (const name of ['main', 'feature/fix-ui', 'release/v1.2', '修复/登录', 'a'.repeat(255)]) assert.equal(isValidContributionBranch(name), true, name);
  let reads = 0;
  const client = contributor({ repo: async () => { reads++; return fork; } });
  for (const name of ['', '@', '-option', '../main', 'a..b', '/main', 'main/', 'a//b', '.hidden', 'fix/.hidden', 'main.', 'main.lock', 'fix.lock/next', 'owner:branch', 'main~1', 'main^', 'main@{0}', 'has space', 'line\nnext', 'x\u0000y', 'fix?abc', 'fix*abc', 'fix[abc', 'fix\\abc', 'a'.repeat(256)]) {
    assert.equal(isValidContributionBranch(name), false, name);
    await assert.rejects(() => loadForkComparison(client, fork, false, { headBranch: name, baseBranch: 'develop' }), /有效/);
  }
  assert.equal(reads, 0);
});

test('custom source and target branches drive validation, comparison, duplicate lookup and creation', async () => {
  const calls = [];
  const branches = { headBranch: 'feature/fix-ui', baseBranch: 'release/stable' };
  const client = contributor({
    branch: async (...args) => { calls.push(['branch', ...args]); return { name: args[2] }; },
    compare: async (...args) => { calls.push(['compare', ...args]); return { ahead_by: 3 }; },
    openPullRequestForHead: async (...args) => { calls.push(['existing', ...args]); return []; },
    createPullRequest: async (...args) => { calls.push(['create', ...args]); return { id: 8 }; },
  });
  const result = await loadForkComparison(client, fork, false, branches);
  assert.deepEqual(result.branches, branches);
  assert.equal(result.fork.default_branch, 'main');
  assert.equal(result.fork.parent.default_branch, 'develop');
  assert.deepEqual(calls, [
    ['branch', 'alice', 'project', 'feature/fix-ui'], ['branch', 'author', 'original', 'release/stable'],
    ['compare', 'author', 'original', 'release/stable', 'alice', 'feature/fix-ui'],
    ['existing', 'author', 'original', 'alice', 'feature/fix-ui', 'release/stable'],
  ]);
  calls.length = 0;
  await submitForkContribution(client, fork, 'Fix UI', 'Existing GitHub changes', false, branches);
  assert.deepEqual(calls.at(-1), ['create', 'author', 'original', { title: 'Fix UI', body: 'Existing GitHub changes', head: 'alice:feature/fix-ui', base: 'release/stable' }]);
});

test('missing or renamed branches reject before comparison and all remote writes', async () => {
  const branches = { headBranch: 'feature/fix-ui', baseBranch: 'develop' };
  let comparisons = 0; let writes = 0;
  const client = contributor({ compare: async () => { comparisons++; return { ahead_by: 1 }; }, createPullRequest: async () => { writes++; return {}; } });
  for (const branch of [async () => { throw notFound(); }, async () => ({ name: 'renamed' })]) {
    await assert.rejects(() => submitForkContribution({ ...client, branch }, fork, 'Fix', '', false, branches), /分支不存在或已改名/);
  }
  assert.equal(comparisons, 0);
  assert.equal(writes, 0);
});

test('custom branches stay restricted to the signed-in fork and its verified upstream', async () => {
  const branches = { headBranch: 'feature/fix-ui', baseBranch: 'develop' };
  let writes = 0;
  const client = contributor({ createPullRequest: async () => { writes++; return {}; } });
  await assert.rejects(() => submitForkContribution({ ...client, user: async () => ({ login: 'other' }) }, fork, 'Fix', '', false, branches), /可写仓库副本/);
  await assert.rejects(() => submitForkContribution({ ...client, repo: async (owner) => owner === 'author' ? { ...upstream, id: 999 } : fork }, fork, 'Fix', '', false, branches), /已变化/);
  await assert.rejects(() => submitForkContribution({ ...client, repo: async () => ({ ...fork, parent: { ...fork.parent, id: 999 } }) }, fork, 'Fix', '', false, branches), /已变化/);
  const existing = { id: 42, number: 7 };
  assert.equal((await submitForkContribution({ ...client, openPullRequestForHead: async () => [existing] }, fork, 'Fix', '', false, branches)).id, 42);
  assert.equal(writes, 0);
});

test('changing the default branch cannot redirect an explicitly selected contribution', async () => {
  let upstreamReads = 0; const writes = [];
  const branches = { headBranch: 'feature/fix-ui', baseBranch: 'release/stable' };
  const client = contributor({
    repo: async (owner) => owner === 'author' ? { ...upstream, default_branch: ++upstreamReads === 1 ? 'develop' : 'new-default' } : fork,
    createPullRequest: async (...args) => { writes.push(args); return { id: 6 }; },
  });
  await submitForkContribution(client, fork, 'Fix', '', false, branches);
  assert.equal(writes[0][2].head, 'alice:feature/fix-ui');
  assert.equal(writes[0][2].base, 'release/stable');
});

test('fork refresh forwards cancellation through every read and stops after a late aborted response', async () => {
  const controller = new AbortController();
  const calls = [];
  const branches = { headBranch: 'feature/fix-ui', baseBranch: 'release/stable' };
  const client = contributor({
    repo: async (owner, _name, signal) => { calls.push(['repo', signal]); return owner === 'author' ? upstream : fork; },
    user: async (signal) => { calls.push(['user', signal]); return identity(); },
    branch: async (...args) => { calls.push(['branch', args.at(-1)]); return { name: args[2] }; },
    compare: async (...args) => { calls.push(['compare', args.at(-1)]); return { ahead_by: 2 }; },
    openPullRequestForHead: async (...args) => { calls.push(['existing', args.at(-1)]); return []; },
  });
  await loadForkComparison(client, fork, false, branches, controller.signal);
  assert.deepEqual(calls.map(([kind]) => kind), ['repo', 'user', 'repo', 'branch', 'branch', 'compare', 'existing']);
  assert.equal(calls.every(([, signal]) => signal === controller.signal), true);
  calls.length = 0; controller.abort();
  await assert.rejects(loadForkComparison(client, fork, false, branches, controller.signal), /Aborted/);
  assert.equal(calls.length, 0);
  const late = new AbortController(); let branchReads = 0;
  await assert.rejects(loadForkComparison(contributor({
    repo: async (owner) => { if (owner === 'author') { late.abort(); return upstream; } return fork; },
    branch: async () => { branchReads++; return { name: 'main' }; },
  }), fork, false, branches, late.signal), /Aborted/);
  assert.equal(branchReads, 0);
});

test('protection refresh forwards cancellation and never turns an aborted 404 into a valid unprotected state', async () => {
  const controller = new AbortController(); const signals = [];
  const state = await loadProtectionState({
    branch: async (_owner, _name, _branch, signal) => { signals.push(signal); return { protected: false }; },
    branchProtection: async (_owner, _name, _branch, signal) => { signals.push(signal); throw notFound(); },
  }, repository(), controller.signal);
  assert.equal(state.enabled, false);
  assert.deepEqual(signals, [controller.signal, controller.signal]);
  const cancelled = new AbortController();
  await assert.rejects(loadProtectionState({
    branch: async () => ({ protected: false }),
    branchProtection: async () => { cancelled.abort(); throw notFound(); },
  }, repository(), cancelled.signal), /Aborted/);
});

test('settings reject stale repository IDs, changed visibility, lost admin rights and public mode', async () => {
  const expected = repository(); let writes = 0;
  const client = { user: identity, repo: async () => expected, updateVisibility: async () => { writes++; } };
  const input = { action: 'visibility', confirmation: expected.name };
  for (const extra of [{ id: 100 }, { private: true }, { permissions: { admin: false } }, { archived: true }]) {
    await assert.rejects(() => applyRepositorySetting({ ...client, repo: async () => ({ ...expected, ...extra }) }, expected, input));
  }
  await assert.rejects(() => applyRepositorySetting(client, expected, { ...input, publicMode: true }), /公开浏览/);
  await assert.rejects(() => applyRepositorySetting(client, expected, { ...input, confirmation: 'wrong' }), /确认/);
  assert.equal(writes, 0);
});

test('archive, transfer and deletion require current repository permissions and concrete confirmation', async () => {
  const expected = repository(); const calls = [];
  const client = { user: identity, repo: async () => expected, setArchived: async (...args) => { calls.push(['archive', ...args]); return { ...expected, archived: true }; }, transferRepo: async (...args) => { calls.push(['transfer', ...args]); return expected; }, deleteRepository: async (...args) => { calls.push(['delete', ...args]); } };
  await applyRepositorySetting(client, expected, { action: 'archive', confirmation: 'project' });
  await assert.rejects(() => applyRepositorySetting(client, expected, { action: 'transfer', confirmation: 'alice/project', targetOwner: 'alice' }), /其他用户/);
  await applyRepositorySetting(client, expected, { action: 'transfer', confirmation: 'alice/project', targetOwner: 'new-owner' });
  await assert.rejects(() => applyRepositorySetting(client, expected, { action: 'delete', confirmation: 'project' }), /确认/);
  await applyRepositorySetting(client, expected, { action: 'delete', confirmation: 'alice/project' });
  assert.deepEqual(calls, [['archive', 'alice', 'project', true], ['transfer', 'alice', 'project', 'new-owner'], ['delete', 'alice', 'project']]);
});

test('branch rules never overwrite rulesets or act on a changed branch or protection state', async () => {
  const expected = repository(); let writes = 0;
  const client = { user: identity, repo: async () => expected, branch: async () => ({ name: 'main', protected: true }), branchProtection: async () => { throw notFound(); }, createBasicBranchProtection: async () => { writes++; }, deleteBranchProtection: async () => { writes++; } };
  const state = await loadProtectionState(client, expected);
  assert.equal(state.externalRules, true);
  const input = { action: 'protection', confirmation: 'alice/project', protection: { branch: 'main', enabled: false } };
  await assert.rejects(() => applyRepositorySetting(client, expected, input), /其他规则/);
  await assert.rejects(() => applyRepositorySetting({ ...client, repo: async () => ({ ...expected, default_branch: 'trunk' }) }, expected, input), /已变化/);
  await assert.rejects(() => applyRepositorySetting({ ...client, branchProtection: async () => ({ required_pull_request_reviews: {} }) }, expected, input), /已变化/);
  assert.equal(writes, 0);
});

test('default branch protection is created only after the current state is checked', async () => {
  const expected = repository(); const calls = []; let protectedBranch = false;
  const client = { user: identity, repo: async () => expected, branch: async () => ({ name: 'main', protected: protectedBranch }), branchProtection: async () => { if (!protectedBranch) throw notFound(); return { required_pull_request_reviews: { required_approving_review_count: 1 } }; }, createBasicBranchProtection: async (...args) => { calls.push(args); protectedBranch = true; } };
  const result = await applyRepositorySetting(client, expected, { action: 'protection', confirmation: 'alice/project', protection: { branch: 'main', enabled: false, externalRules: false } });
  assert.deepEqual(calls, [['alice', 'project', 'main']]);
  assert.equal(result.enabled, true);
  assert.equal(result.reviewsRequired, 1);
});

test('deletion scope is requested separately and must authorize the signed-in account', async () => {
  let options;
  await requestDeletionDeviceCode(undefined, async (_url, init) => { options = init; return Response.json({ device_code: 'd' }); });
  assert.equal(new URLSearchParams(options.body).get('scope'), 'repo read:user delete_repo');
  assert.doesNotThrow(() => assertDeletionAccount('ALICE', 'alice'));
  assert.throws(() => assertDeletionAccount('alice', 'someone-else'), /账号/);
});
