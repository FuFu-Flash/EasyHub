import type { MenuCommand } from '../../../shared/applicationMenu';
import { getTranslator, type Translator } from '../localization';
import type { DemoNotice } from '../demo/demoBridge';
import type { GitHubActivityCount, GitHubRepo, GitHubUser } from '@easyhub/github';
import type { LocalProjectLink, LocalProjectStatus, SyncPreview, TranslationTargetLanguage } from '@easyhub/types';
import type { ReactNode, SetStateAction } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { useEasyHub, useWorkspaceStorage } from '../bridge';
import { useDownloadCenter } from '../components/useDownloadCenter';
import { errorText } from '../errors';
import { readLanguage, type Language } from '../i18n';
import { useLayoutPreference } from '../layoutPreferences';
import { readWindowStyle } from '../windowStyle';
import { useThemePreference } from '../themePreferences';
import { publicBookmarksKey, readPublicBookmarks } from '../publicBookmarks';
import { historyKey, readSearchHistory, rememberSearch, type SearchEntry, type SearchScope } from '../searchHistory';
import { useWorkspaceNavigation } from './NavigationContext';

export interface WorkspaceProps {
  initialMenuCommand?: MenuCommand;
  user: GitHubUser;
  onLogout: () => void | Promise<void>;
  offline?: boolean;
  authRetrying?: boolean;
  onRetryAuth?: () => void;
  demo?: { only: boolean; onLogin: () => void; onNotice: (callback: (notice: DemoNotice) => void) => () => void };
}
export interface SharedState {
  user: GitHubUser;
  repos: GitHubRepo[];
  localLinks: LocalProjectLink[];
  localStatuses: Record<string, LocalProjectStatus>;
  remotePreviews: Record<string, SyncPreview>;
  localErrors: Record<string, boolean>;
  activityCounts: Record<number, GitHubActivityCount>;
  activityError: string;
  checkingLocal: boolean;
  loading: boolean;
  language: Language;
  windowStyle: 'windows' | 'reference';
  automaticTranslation: boolean;
  translationTarget: TranslationTargetLanguage;
  translationNamesText: string;
  searchDisplayMode: 'compact' | 'detailed';
  savedPublicRepos: GitHubRepo[];
  searchHistory: SearchEntry[];
  notice: string;
  error: string;
  refreshError: string;
  refreshRevision: number;
}
type Change = {
  [K in keyof SharedState]: { type: 'set'; key: K; value: SetStateAction<SharedState[K]> };
}[keyof SharedState];
export function workspaceReducer(state: SharedState, action: Change): SharedState {
  const value =
    typeof action.value === 'function'
      ? (action.value as (old: SharedState[typeof action.key]) => SharedState[typeof action.key])(state[action.key])
      : action.value;
  return Object.is(value, state[action.key])
    ? state
    : { ...state, [action.key]: value, ...(action.key === 'language' ? { notice: '' } : {}) };
}
function useController(props: WorkspaceProps) {
  const easyHub = useEasyHub()!,
    storage = useWorkspaceStorage(),
    navigation = useWorkspaceNavigation();
  const [state, dispatch] = useReducer(workspaceReducer, undefined, (): SharedState => {
    let repos: GitHubRepo[] = [];
    try {
      const saved: unknown = JSON.parse(storage.getItem('easyhub:repos:' + props.user.login) ?? '[]');
      if (Array.isArray(saved))
        repos = saved.filter((repo) => repo && Number.isSafeInteger(repo.id) && repo.name && repo.owner?.login);
    } catch {
      /* Cache is optional. */
    }
    return {
      user: props.user,
      repos,
      localLinks: [],
      localStatuses: {},
      remotePreviews: {},
      localErrors: {},
      activityCounts: {},
      activityError: '',
      checkingLocal: false,
      loading: false,
      language: readLanguage(),
      windowStyle: readWindowStyle(),
      automaticTranslation: localStorage.getItem('easyhub:auto-translate') === 'true',
      translationTarget: localStorage.getItem('easyhub:translation-target') === 'en' ? 'en' : 'zh-CN',
      translationNamesText: storage.getItem(`easyhub:translation-names:${props.user.login}`) ?? '',
      searchDisplayMode: localStorage.getItem('easyhub:search-display-mode') === 'detailed' ? 'detailed' : 'compact',
      savedPublicRepos: readPublicBookmarks(storage, props.user.login),
      searchHistory: readSearchHistory(storage, props.user.login),
      notice: '',
      error: '',
      refreshError: '',
      refreshRevision: 0,
    };
  });
  const languageRef = useRef(state.language);
  languageRef.current = state.language;
  const t = useCallback<Translator>((key, ...params) => getTranslator(languageRef.current)(key, ...params), []);
  const cache = useRef(new Map<string, unknown>());
  const alive = useRef(true),
    loads = useRef(0),
    locals = useRef(0);
  const set = useCallback(
    <K extends keyof SharedState>(key: K, value: SetStateAction<SharedState[K]>) =>
      dispatch({ type: 'set', key, value } as Change),
    [],
  );
  useEffect(() => {
    set('user', props.user);
  }, [props.user, set]);
  const api = useCallback(<T,>(action: string, ...args: unknown[]) => easyHub.github<T>(action, ...args), [easyHub]);
  const refreshActivityCount = useCallback(
    async (repo?: GitHubRepo) => {
      try {
        const counts = await api<Record<number, GitHubActivityCount>>(
          'activityCounts',
          (repo ? [repo] : state.repos).map((item) => ({ id: item.id, owner: item.owner.login, name: item.name })),
        );
        if (!alive.current) return;
        set('activityCounts', (old) => (repo ? { ...old, ...counts } : counts));
        set('activityError', '');
      } catch {
        if (alive.current) set('activityError', t('workspaceContext.accurateCountsAreUnavailableYouCanStillOpenEach'));
      }
    },
    [api, state.repos, set],
  );
  const loadRepos = useCallback(
    async (background = false): Promise<boolean> => {
      const request = ++loads.current;
      if (!background) set('loading', true);
      try {
        const repos: GitHubRepo[] = [];
        for (let page = 1; page <= 100; page++) {
          const batch = await api<GitHubRepo[]>('repos', page);
          if (!alive.current || request !== loads.current) return false;
          repos.push(...batch);
          if (batch.length < 100) break;
        }
        set('repos', repos);
        try {
          storage.setItem('easyhub:repos:' + props.user.login, JSON.stringify(repos));
        } catch {
          /* Cache is optional. */
        }
        void api<Record<number, GitHubActivityCount>>(
          'activityCounts',
          repos.map((repo) => ({ id: repo.id, owner: repo.owner.login, name: repo.name })),
        )
          .then((counts) => {
            if (alive.current && request === loads.current) {
              set('activityCounts', counts);
              set('activityError', '');
            }
          })
          .catch(() => {
            if (alive.current)
              set('activityError', t('workspaceContext.accurateCountsAreUnavailableYouCanStillOpenEach'));
          });
        return true;
      } catch (cause) {
        if (alive.current && request === loads.current) set(background ? 'refreshError' : 'error', errorText(cause));
        return false;
      } finally {
        if (alive.current && request === loads.current) set('loading', false);
      }
    },
    [api, storage, props.user.login, set],
  );
  const refreshLocalLinks = useCallback(async () => {
    const links = await easyHub.localList();
    if (alive.current) set('localLinks', links);
  }, [easyHub, set]);
  const cancelRepoReads = () => {
    loads.current++;
    set('loading', false);
    void easyHub.cancelGithubReads().catch(() => undefined);
  };
  const downloads = useDownloadCenter(refreshLocalLinks);
  useEffect(() => {
    alive.current = true;
    if (!props.offline) void loadRepos();
    void refreshLocalLinks().catch((cause) => set('error', errorText(cause)));
    return () => {
      alive.current = false;
      loads.current++;
    };
  }, [props.offline, loadRepos, refreshLocalLinks, set]);
  useEffect(
    () =>
      easyHub.onLocalStatus(({ id, status }) => {
        set('localStatuses', (old) => ({ ...old, [id]: status }));
      }),
    [easyHub, set],
  );
  useEffect(() => {
    if (!['home', 'projects', 'project', 'local'].includes(navigation.page.view)) return;
    const request = ++locals.current;
    set('checkingLocal', true);
    void Promise.allSettled(
      state.localLinks.map(async (link) => {
        try {
          const status = await easyHub.localStatus(link.id);
          if (!alive.current || request !== locals.current) return;
          set('localStatuses', (old) => ({ ...old, [link.id]: status }));
          set('localErrors', (old) => ({ ...old, [link.id]: false }));
          if (!status.files.length) {
            const preview = await easyHub.localCheckSync(link.id);
            if (alive.current && request === locals.current)
              set('remotePreviews', (old) => ({ ...old, [link.id]: preview }));
          }
        } catch {
          if (alive.current && request === locals.current) set('localErrors', (old) => ({ ...old, [link.id]: true }));
        }
      }),
    ).finally(() => {
      if (alive.current && request === locals.current) set('checkingLocal', false);
    });
    return () => {
      locals.current++;
    };
  }, [easyHub, navigation.page.view, state.localLinks, state.refreshRevision, set]);
  useEffect(() => {
    set('notice', '');
    set('error', '');
    set('refreshError', '');
  }, [navigation.key, set]);
  useEffect(
    () => props.demo?.onNotice((notice) => set('notice', getTranslator(state.language)(notice.key))),
    [props.demo?.onNotice, state.language, set],
  );
  useEffect(() => {
    const values: Record<string, string> = {
      language: state.language,
      'window-control-style': state.windowStyle,
      'auto-translate': String(state.automaticTranslation),
      'translation-target': state.translationTarget,
      'search-display-mode': state.searchDisplayMode,
    };
    Object.entries(values).forEach(([key, value]) => localStorage.setItem('easyhub:' + key, value));
    storage.setItem(`easyhub:translation-names:${props.user.login}`, state.translationNamesText);
  }, [
    state.language,
    state.windowStyle,
    state.automaticTranslation,
    state.translationTarget,
    state.searchDisplayMode,
    state.translationNamesText,
    props.user.login,
    storage,
  ]);
  const translationNames = useMemo(
    () =>
      [
        ...new Set(
          state.translationNamesText
            .split(/[,\n]/u)
            .map((name) => name.trim())
            .filter((name) => name.length >= 2 && name.length <= 80),
        ),
      ].slice(0, 100),
    [state.translationNamesText],
  );
  const layout = useLayoutPreference();
  const theme = useThemePreference();
  const recordSearch = useCallback(
    (query: string, scope: SearchScope) => {
      if (!query.trim() || ((scope === 'public' || scope === 'users') && query.trim().length < 2)) return;
      set('searchHistory', (old) => {
        const next = rememberSearch(old, query, scope);
        storage.setItem(historyKey(props.user.login), JSON.stringify(next));
        return next;
      });
    },
    [set, storage, props.user.login],
  );
  return {
    ...props,
    ...state,
    easyHub,
    api,
    storage,
    cache: cache.current,
    downloads,
    layout,
    theme,
    translationNames,
    set,
    loadRepos,
    cancelRepoReads,
    refreshLocalLinks,
    refreshActivityCount,
    navigation,
    setNotice: (value: string | null) => set('notice', value ?? ''),
    setError: (value: string) => set('error', value),
    recordSearch,
    clearSearchHistory: () => {
      set('searchHistory', []);
      storage.removeItem(historyKey(props.user.login));
    },
    addPublicProject: (repo: GitHubRepo) =>
      set('savedPublicRepos', (old) => {
        const next = [repo, ...old.filter((item) => item.id !== repo.id)].slice(0, 50);
        storage.setItem(publicBookmarksKey(props.user.login), JSON.stringify(next));
        return next;
      }),
  };
}
const WorkspaceContext = createContext<ReturnType<typeof useController> | null>(null);
export function WorkspaceProvider({ children, ...props }: WorkspaceProps & { children: ReactNode }) {
  const value = useController(props);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error('Workspace data is unavailable');
  return value;
}
