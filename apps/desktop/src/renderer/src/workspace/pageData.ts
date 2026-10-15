import type { GitHubRepo } from '@easyhub/github';
import type { SetStateAction } from 'react';
import { useContext, useEffect, useRef, useState } from 'react';
import { PageActivityContext } from '../components/NavigationPages';
import { errorText } from '../errors';
import { usePageRoute } from './NavigationContext';
import { useWorkspace } from './WorkspaceContext';

/** Data belongs to the page. A cache keeps its content visible during revalidation. */
export function usePageData<T>(key: string, load: () => Promise<T>, initial: T, watch = '') {
  const { cache, refreshRevision, set, cancelRepoReads } = useWorkspace(),
    active = useContext(PageActivityContext);
  const [snapshot, update] = useState<{ key: string; value: T }>(() => ({
    key,
    value: cache.has(key) ? (cache.get(key) as T) : initial,
  }));
  // A new search/branch must never briefly display results for a different key.
  const data = snapshot.key === key ? snapshot.value : cache.has(key) ? (cache.get(key) as T) : initial;
  const [loading, setLoading] = useState(!cache.has(key)),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  const generation = useRef(0);
  useEffect(() => {
    if (!active) return;
    const request = ++generation.current;
    let present = true;
    setLoading(true);
    setError('');
    void loader
      .current()
      .then((value) => {
        if (present && generation.current === request) {
          cache.set(key, value);
          update({ key, value });
        }
      })
      .catch((cause) => {
        if (present && generation.current === request) {
          if (cache.has(key)) set('refreshError', errorText(cause));
          else setError(errorText(cause));
        }
      })
      .finally(() => {
        if (present && generation.current === request) setLoading(false);
      });
    return () => {
      present = false;
      generation.current++;
    };
  }, [key, active, revision, refreshRevision, cache, watch]);
  const setData = (next: SetStateAction<T>) =>
    update((old) => {
      const current = old.key === key ? old.value : cache.has(key) ? (cache.get(key) as T) : initial;
      const value = typeof next === 'function' ? (next as (value: T) => T)(current) : next;
      cache.set(key, value);
      return { key, value };
    });
  const cancel = () => {
    generation.current++;
    setLoading(false);
    setError('');
    cancelRepoReads();
  };
  return { data, setData, loading, error, cancel, reload: () => setRevision((old) => old + 1) };
}
export function useRepository(): GitHubRepo | null {
  const { params } = usePageRoute(),
    { repos, api, cache } = useWorkspace();
  const known =
    repos.find((repo) => repo.full_name.toLowerCase() === params.repo?.toLowerCase()) ??
    (cache.get('repo:' + params.repo) as GitHubRepo | undefined);
  const result = usePageData<GitHubRepo | null>(
    'repo:' + params.repo,
    async () => {
      if (!params.repo) return null;
      if (known) return known;
      const [owner, name] = params.repo.split('/');
      return api<GitHubRepo>('repository', owner, name);
    },
    known ?? null,
  );
  return known ?? result.data;
}

/** Remember an opened list window across visits; an explicit visible refresh resets it. */
export function useReadingWindow() {
  const { refreshRevision } = useWorkspace(),
    active = useContext(PageActivityContext);
  const pages = useRef(1);
  const previous = useRef({ active, revision: refreshRevision });
  if (active && previous.current.active && previous.current.revision !== refreshRevision) {
    pages.current = 1;
  }
  previous.current = { active, revision: refreshRevision };
  return { pages };
}
