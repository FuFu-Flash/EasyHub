import type { GitHubPullFile } from '@easyhub/github';

export interface PatchLine { kind: 'hunk' | 'add' | 'remove' | 'context' | 'note'; text: string; before: number | null; after: number | null }
export interface ParsedPatch { lines: PatchLine[]; incomplete: boolean; limited: boolean; additions: number; deletions: number }
const MAX_PATCH_LENGTH = 300_000;
const MAX_PATCH_LINES = 5_000;
export function parsePullPatch(file: Pick<GitHubPullFile, 'patch' | 'additions' | 'deletions'>): ParsedPatch {
  const patch = file.patch ?? '';
  const raw = patch.slice(0, MAX_PATCH_LENGTH).split('\n');
  const limited = patch.length > MAX_PATCH_LENGTH || raw.length > MAX_PATCH_LINES;
  const lines: PatchLine[] = [];
  let before = 0, after = 0, remainingBefore = 0, remainingAfter = 0, additions = 0, deletions = 0;
  let inHunk = false, invalid = false;
  for (const [index, line] of raw.slice(0, MAX_PATCH_LINES).entries()) {
    if (line === '' && index === raw.length - 1) continue;
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (hunk) {
      if (inHunk && (remainingBefore !== 0 || remainingAfter !== 0)) invalid = true;
      before = Number(hunk[1]); after = Number(hunk[3]);
      remainingBefore = Number(hunk[2] ?? 1); remainingAfter = Number(hunk[4] ?? 1);
      inHunk = true; lines.push({ kind: 'hunk', text: line, before: null, after: null }); continue;
    }
    if (line.startsWith('\\ ')) { lines.push({ kind: 'note', text: line.slice(2), before: null, after: null }); continue; }
    if (!inHunk || !['+', '-', ' '].includes(line[0] ?? '')) { invalid = true; lines.push({ kind: 'note', text: line, before: null, after: null }); continue; }
    if (line[0] === '+') { additions++; remainingAfter--; lines.push({ kind: 'add', text: line.slice(1), before: null, after: after++ }); }
    else if (line[0] === '-') { deletions++; remainingBefore--; lines.push({ kind: 'remove', text: line.slice(1), before: before++, after: null }); }
    else { remainingBefore--; remainingAfter--; lines.push({ kind: 'context', text: line.slice(1), before: before++, after: after++ }); }
    if (remainingBefore < 0 || remainingAfter < 0) invalid = true;
  }
  return { lines, additions, deletions, limited, incomplete: limited || invalid || !inHunk || remainingBefore !== 0 || remainingAfter !== 0 || additions !== file.additions || deletions !== file.deletions };
}
