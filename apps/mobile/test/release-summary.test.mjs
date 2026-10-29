import test from "node:test";
import assert from "node:assert/strict";
import { releaseSummary } from "../features/github/releaseSummary.ts";

test("release previews keep the prose and drop Markdown tables", () => {
  const notes =
    "本次更新\n\n| 安装包 | 适合设备 |\n| --- | --- |\n| arm64 APK | 现代 Android 手机 |\n\n修复了下载进度。";
  assert.equal(releaseSummary(notes), "本次更新 修复了下载进度。");
});

test("release previews flatten links, headings and emphasis and stay short", () => {
  assert.equal(releaseSummary("## New\n\n- **Faster** [downloads](https://example.com/a)"), "New Faster downloads");
  assert.ok(releaseSummary("x".repeat(500)).length <= 220);
  assert.equal(releaseSummary(null), "");
  assert.equal(releaseSummary("| a | b |\n| - | - |"), "");
});
