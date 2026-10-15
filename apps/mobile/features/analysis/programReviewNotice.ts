import type { GitHubPullFile } from '@easyhub/github';
import { isEmptyAddedPullFile } from '@easyhub/github/pull-files';
import { frameworkForFile, type AnalysisFrameworkComponent } from './frameworks.ts';

/** Device preference, independent of account, language, and any program evidence. */
export function parseProgramReviewNoticesEnabled(value: unknown): boolean { return value !== 'false'; }

export function createProgramReviewNoticeStore(storage: { read(): string | null; write(value: string): void }) {
  let enabled = true;
  try { enabled = parseProgramReviewNoticesEnabled(storage.read()); } catch { /* Keep the session default. */ }
  const listeners = new Set<() => void>();
  return {
    snapshot: () => enabled,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    set(value: boolean) {
      if (value === enabled) return;
      enabled = value;
      try { storage.write(String(value)); } catch { /* The choice still applies to this session. */ }
      for (const listener of listeners) listener();
    },
  };
}
export function missingProgramReviewComponents(files: GitHubPullFile[], components: AnalysisFrameworkComponent[]) {
  const needed = new Set(files.filter((file) => file.status !== 'removed' && !file.patch && !isEmptyAddedPullFile(file)).map((file) => frameworkForFile(file.filename)));
  return components.filter((item) => needed.has(item.id) && item.supported && !item.installed);
}

