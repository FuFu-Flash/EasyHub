import test from "node:test";
import assert from "node:assert/strict";
import { homeTaskGroups } from "../features/github/homeTasks.ts";

const repo = (id, name) => ({ id, name, owner: { login: "me" } });
const counts = (issues, pullRequests) => ({ issues, pullRequests, closedIssues: 0, closedPullRequests: 0 });

test("home tasks merge a project's issues and pull requests into one entry, busiest project first", () => {
  const repos = [repo(1, "a"), repo(2, "b"), repo(3, "c"), repo(4, "d")];
  const groups = homeTaskGroups(repos, { 1: counts(1, 9), 2: counts(5, 0), 3: counts(0, 0), 4: counts(1, 2) });
  assert.deepEqual(
    groups.map((group) => [group.repo.name, group.issues, group.pulls]),
    [
      ["a", 1, 9],
      ["b", 5, 0],
      ["d", 1, 2],
    ],
  );
});

test("projects with equal workloads keep their original order", () => {
  const groups = homeTaskGroups([repo(1, "a"), repo(2, "b")], { 1: counts(2, 0), 2: counts(0, 2) });
  assert.deepEqual(
    groups.map((group) => group.repo.name),
    ["a", "b"],
  );
});

test("home tasks ignore projects whose counts have not loaded", () => {
  assert.deepEqual(homeTaskGroups([repo(1, "a")], {}), []);
});
