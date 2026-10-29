import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import ts from "typescript";
import { createPagedList } from "../features/github/pagedList.ts";
import { createCommitChangesReader, parseCommitPatch } from "../features/github/sourceHistory.ts";
import { explainCommit } from "../features/ai/commitExplanation.ts";

// Exercise the real shared client. Node's strip-only TS mode cannot compile its
// parameter properties, so use the existing TypeScript dev dependency for this file.
const githubUrl = new URL("../../../packages/github/src/index.ts", import.meta.url).href;
const loader = registerHooks({
  load(url, context, next) {
    if (url !== githubUrl) return next(url, context);
    return {
      format: "module",
      shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), "utf8"), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      }).outputText,
    };
  },
});
const { createUiTestClient, createUiTestTransport } = await import("../features/auth/uiTestFixtures.ts");
const { GitHubClient } = await import(githubUrl);
loader.deregister();

const OWNER = "easyhub-ui";
const REPO = "history-pagination";
const SHA = "1".padStart(40, "0");

test("controlled workspace branches and commits use valid stable identities and real API pagination", async () => {
  const client = createUiTestClient();
  const firstBranches = await client.branchesPage(OWNER, REPO, 1);
  const moreBranches = await client.branchesPage(OWNER, REPO, 2);
  assert.equal(firstBranches.items.length, 100);
  assert.equal(firstBranches.nextPage, 2);
  assert.equal(moreBranches.items.length, 2);
  assert.equal(moreBranches.nextPage, null);
  assert.equal(new Set([...firstBranches.items, ...moreBranches.items].map((item) => item.name)).size, 102);
  assert.equal((await client.branch(OWNER, REPO, "feature/fix-ui")).name, "feature/fix-ui");
  const first = await client.sourceHistory(OWNER, REPO, { branch: "main", page: 1 });
  const more = await client.sourceHistory(OWNER, REPO, { branch: "main", page: 2 });
  assert.equal(first.items.length, 100);
  assert.equal(first.nextPage, 2);
  assert.equal(more.items.length, 1);
  assert.equal(more.nextPage, null);
  assert.equal(first.items[0].sha, SHA);
  assert.match(first.items[0].commit.message, /分页测试/);
  assert.equal(
    first.items.some((item) => item.files !== undefined),
    false,
  );
  assert.equal(new Set([...first.items, ...more.items].map((item) => item.sha)).size, 101);
});

test("branch and path filters identify different immutable commits without leaking prior results", async () => {
  const client = createUiTestClient();
  const readme = await client.sourceHistory(OWNER, REPO, { branch: "main", path: "README.md", page: 1 });
  assert.equal(readme.items.length, 2);
  assert.deepEqual(
    readme.items.map((item) => item.sha),
    [SHA, (101).toString(16).padStart(40, "0")],
  );
  const feature = await client.sourceHistory(OWNER, REPO, {
    branch: "feature/fix-ui",
    path: "src/refresh/indicator.ts",
    page: 1,
  });
  assert.deepEqual(
    feature.items.map((item) => item.sha),
    ["9".repeat(40)],
  );
  const develop = await client.sourceHistory(OWNER, REPO, { branch: "develop", path: "src/navigation", page: 1 });
  assert.deepEqual(
    develop.items.map((item) => item.sha),
    ["8".repeat(40)],
  );
  assert.deepEqual(
    (await client.sourceHistory(OWNER, REPO, { branch: "main", path: "does-not-exist.ts", page: 1 })).items,
    [],
  );
  assert.deepEqual((await client.sourceHistory(OWNER, REPO, { branch: "empty-history", page: 1 })).items, []);
  await assert.rejects(client.sourceHistory(OWNER, REPO, { branch: "unknown-branch", page: 1 }), { status: 404 });
});

test("commit details page files independently, preserve valid text diffs, and link back to changed-file history", async () => {
  const client = createUiTestClient();
  const first = await client.commitChangesPage(OWNER, REPO, SHA, 1);
  const more = await client.commitChangesPage(OWNER, REPO, SHA, 2);
  assert.equal(first.commit.files.length, 100);
  assert.equal(first.nextPage, 2);
  assert.equal(more.commit.files.length, 1);
  assert.equal(more.nextPage, null);
  const files = [...first.commit.files, ...more.commit.files];
  assert.equal(new Set(files.map((item) => item.filename)).size, 101);
  for (const file of files.filter((item) => item.patch))
    assert.equal(parseCommitPatch(file).incomplete, false, file.filename);
  const renamed = files.find((item) => item.status === "renamed");
  assert.match(renamed.previous_filename, /ProjectCard\.tsx$/);
  assert.equal(
    (await client.sourceHistory(OWNER, REPO, { branch: "main", path: renamed.filename, page: 1 })).items[0].sha,
    SHA,
  );
  await assert.rejects(client.commitChangesPage(OWNER, REPO, "f".repeat(40), 1), { status: 404 });
});

test("real client list revalidation retains all 101 rows after a failed second page and retries the opened window", async () => {
  const transport = createUiTestTransport();
  const calls = [];
  let fail = false;
  const client = new GitHubClient(
    async () => "fixture-only",
    async (input, init) => {
      const url = new URL(input);
      const page = Number(url.searchParams.get("page") || 1);
      calls.push(page);
      return fail && page === 2
        ? Response.json({ message: "One controlled revalidation failure" }, { status: 503 })
        : transport(input, init);
    },
  );
  const list = createPagedList(
    (page, signal) => client.sourceHistory(OWNER, REPO, { branch: "main", page }, signal),
    (item) => item.sha,
  );
  await list.revalidate();
  await list.more();
  const before = list.snapshot().items;
  fail = true;
  list.cancel();
  await list.revalidate();
  assert.equal(list.snapshot().failedPage, 2);
  assert.equal(list.snapshot().items, before);
  fail = false;
  await list.more();
  assert.equal(list.snapshot().items.length, 101);
  assert.equal(list.snapshot().failedPage, null);
  assert.deepEqual(calls, [1, 2, 1, 2, 1, 2]);
  await list.refresh();
  assert.equal(list.snapshot().items.length, 100);
});

test("real client commit reader keeps the opened file window across visits and failures", async () => {
  const transport = createUiTestTransport();
  let fail = false;
  const client = new GitHubClient(
    async () => "fixture-only",
    async (input, init) => {
      const url = new URL(input);
      return fail && url.searchParams.get("page") === "2"
        ? Response.json({ message: "Controlled file-page failure" }, { status: 503 })
        : transport(input, init);
    },
  );
  const reader = createCommitChangesReader(SHA, (page, signal) =>
    client.commitChangesPage(OWNER, REPO, SHA, page, signal),
  );
  await reader.reload();
  await reader.more();
  const before = reader.snapshot().commit;
  fail = true;
  reader.cancel();
  await reader.revalidate();
  assert.equal(reader.snapshot().commit, before);
  assert.equal(reader.snapshot().failedPage, 2);
  fail = false;
  await reader.retry();
  assert.equal(reader.snapshot().commit.files.length, 101);
  await reader.reload();
  assert.equal(reader.snapshot().commit.files.length, 100);
});

test("controlled commit explanation integrates the real fixture without calling an external AI service", async () => {
  let sends = 0;
  const result = await explainCommit({
    client: createUiTestClient(),
    owner: OWNER,
    repo: REPO,
    sha: SHA,
    settings: { providerId: "openai", model: "fixture-model", apiKey: "in-memory-fixture-key" },
    language: "en",
    signal: new AbortController().signal,
    consentToSend: true,
    providerBaseUrl: "https://api.openai.com/v1",
    fetcher: async (_url, init) => {
      sends++;
      const evidence = JSON.parse(JSON.parse(init.body).messages[1].content);
      assert.equal(evidence.sha, SHA);
      assert.equal(evidence.partial, true);
      assert.equal(evidence.files.length <= 100, true);
      assert.equal(
        evidence.files.some((file) => file.path.endsWith(".exe") && file.patch !== undefined),
        false,
      );
      return Response.json({
        choices: [
          {
            finish_reason: "stop",
            message: { content: JSON.stringify({ explanation: "The supplied changes preserve the reader’s place." }) },
          },
        ],
      });
    },
  });
  assert.equal(sends, 1);
  assert.equal(result.partial, true);
});

test("fixture transports reject other origins and keep writes isolated to each in-memory instance", async () => {
  const first = createUiTestTransport();
  const second = createUiTestTransport();
  assert.equal((await first("https://example.com/real-network")).status, 403);
  const path = "https://api.github.com/repos/easyhub-ui/EasyHub/issues";
  const created = await first(path, {
    method: "POST",
    body: JSON.stringify({ title: "An isolated draft", body: "Fixture only" }),
  });
  assert.equal(created.status, 201);
  const number = (await created.json()).number;
  assert.equal((await first(`${path}/${number}`)).status, 200);
  assert.equal((await second(`${path}/${number}`)).status, 404);
});
