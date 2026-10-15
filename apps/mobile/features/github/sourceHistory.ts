import type { GitHubCommit, GitHubCommitChangesPage, GitHubPullFile } from '@easyhub/github';

export interface CommitChangesState {
  commit: GitHubCommit | null;
  busy: boolean;
  nextPage: number | null;
  failedPage: number | null;
  limited: boolean;
}

/** One immutable commit owns its file window, including transports that ignore abort. */
export function createCommitChangesReader(sha: string, load: (page: number, signal: AbortSignal) => Promise<GitHubCommitChangesPage>) {
  let state: CommitChangesState = { commit: null, busy: false, nextPage: 1, failedPage: null, limited: false };
  let generation = 0;
  let pages = 0;
  let controller: AbortController | null = null;
  let pending: Promise<void> | null = null;
  let retryRange = { first: 1, last: 1 };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<CommitChangesState>) => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
  const cancel = () => { generation++; controller?.abort(); controller = null; pending = null; publish({ busy: false }); };
  const read = (firstPage: number, lastPage: number): Promise<void> => {
    if (pending) return pending;
    const current = new AbortController(); controller = current;
    const revision = generation;
    retryRange = { first: firstPage, last: lastPage };
    const active = () => controller === current && generation === revision && !current.signal.aborted;
    publish({ busy: true, failedPage: null });
    let page = firstPage;
    const task = (async () => {
      // Establish the shared promise before a loader is allowed to throw synchronously.
      await Promise.resolve();
      try {
        let commit = firstPage === 1 ? null : state.commit;
        const files = new Map((commit?.files ?? []).map(file => [file.filename, file]));
        let nextPage: number | null = firstPage;
        let limited = false;
        let loadedPage = firstPage - 1;
        do {
          if (!active()) return;
          const result = await load(page, current.signal);
          if (!active()) return;
          if (!/^[a-f0-9]{40}$/iu.test(sha) || result.commit?.sha?.toLowerCase() !== sha.toLowerCase() || !Array.isArray(result.commit.files)
            || result.nextPage !== null && (result.nextPage !== page + 1 || result.nextPage > 30)) throw new Error('Invalid commit file page');
          if (!commit || firstPage === 1 && page === 1) commit = result.commit;
          for (const file of result.commit.files) files.set(file.filename, { ...file });
          nextPage = result.nextPage; limited ||= result.limited; loadedPage = page;
          if (nextPage === null || page >= lastPage) break;
          page = nextPage;
        } while (page <= 30);
        if (!active() || !commit) return;
        pages = loadedPage;
        publish({ commit: { ...commit, files: [...files.values()] }, nextPage, limited, failedPage: null });
      } catch { if (active()) publish({ failedPage: page }); }
      finally { if (active()) { controller = null; pending = null; publish({ busy: false }); } }
    })();
    pending = task;
    return task;
  };
  return {
    snapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    cancel,
    reload: () => { cancel(); pages = 1; return read(1, 1); },
    revalidate: () => { cancel(); return read(1, Math.max(1, pages)); },
    retry: () => read(retryRange.first, retryRange.last),
    more: () => state.nextPage !== null ? read(state.nextPage, state.nextPage) : Promise.resolve(),
  };
}

export interface CommitPatchLine { kind: 'hunk' | 'add' | 'remove' | 'context' | 'note'; text: string; before: number | null; after: number | null }

/** The same bounded unified-diff accounting used by the desktop reader. */
export function parseCommitPatch(file: Pick<GitHubPullFile, 'patch' | 'additions' | 'deletions'>) {
  const patch = file.patch ?? '';
  const raw = patch.slice(0, 300_000).split('\n');
  const limited = patch.length > 300_000 || raw.length > 5_000;
  const lines: CommitPatchLine[] = [];
  let before = 0, after = 0, remainingBefore = 0, remainingAfter = 0, additions = 0, deletions = 0;
  let inHunk = false, invalid = false;
  for (const [index, line] of raw.slice(0, 5_000).entries()) {
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
  return { lines, limited, incomplete: limited || invalid || !inHunk || remainingBefore !== 0 || remainingAfter !== 0 || additions !== file.additions || deletions !== file.deletions };
}
