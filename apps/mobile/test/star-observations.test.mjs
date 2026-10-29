import test from "node:test";
import assert from "node:assert/strict";
import { parseObservations, recordObservations, starTrend } from "../features/github/starObservations.ts";

test("mobile hot projects report observed Star increases without inventing first-visit growth", () => {
  const now = Date.UTC(2026, 8, 26, 12);
  const repo = { id: 42, stargazers_count: 11 };
  assert.deepEqual(starTrend(repo, {}, "today", now), { kind: "watching" });
  const old = recordObservations({}, [{ ...repo, stargazers_count: 8 }], now - 2 * 3600000);
  assert.deepEqual(starTrend(repo, old, "today", now), { kind: "gain", count: 3 });
  const same = recordObservations({}, [repo], now - 2 * 3600000);
  assert.deepEqual(starTrend(repo, same, "today", now), { kind: "none" });
});

test("mobile Star observations discard malformed records", () => {
  assert.deepEqual(parseObservations("{bad"), {});
  assert.deepEqual(
    parseObservations(
      JSON.stringify({
        42: [
          { at: 5, stars: 2 },
          { at: "wrong", stars: 4 },
        ],
      }),
    ),
    { 42: [{ at: 5, stars: 2 }] },
  );
});
