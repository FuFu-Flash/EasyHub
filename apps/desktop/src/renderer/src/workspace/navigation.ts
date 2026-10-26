export type View =
  | 'home'
  | 'projects'
  | 'discover'
  | 'profile'
  | 'starred'
  | 'project'
  | 'public-project'
  | 'downloads'
  | 'new-release'
  | 'issues'
  | 'issue'
  | 'pulls'
  | 'history'
  | 'source-history'
  | 'recent-history'
  | 'version'
  | 'new-project'
  | 'local'
  | 'settings';
export type Section = 'home' | 'projects' | 'discover' | 'profile' | 'issues' | 'pulls' | 'settings';
/** Parameters identify content; fetched objects and callbacks never enter history. */
export interface PageParams {
  repo?: string;
  localId?: string;
  number?: number;
  sha?: string;
  login?: string;
  tag?: string;
  download?: boolean;
  edit?: boolean;
  publish?: boolean;
  sync?: boolean;
  scope?: string;
  query?: string;
  page?: number;
  searchPage?: number;
  period?: string;
  filter?: string;
  section?: Section;
  visit?: number;
  nestedKey?: string;
  outerBoundary?: string;
}
export interface Destination {
  view: View;
  params: PageParams;
  scrollTop: number;
}
export interface NavigationState {
  entries: Destination[];
  index: number;
  sections: Partial<Record<Section, Destination>>;
}
export type NavigationAction =
  | { type: 'visit'; page: Destination; replace?: boolean; scrollTop: number }
  | { type: 'move'; delta: number; scrollTop: number }
  | { type: 'params'; params: Partial<PageParams>; scrollTop: number; resetScroll?: boolean }
  | { type: 'scroll'; scrollTop: number }
  | { type: 'sidebar'; section: Section; scrollTop: number }
  | { type: 'remove-repository'; repo: string };
export const initialNavigation = (): NavigationState => ({
  entries: [{ view: 'home', params: {}, scrollTop: 0 }],
  index: 0,
  sections: {},
});
export const pageIdentity = (page: Pick<Destination, 'view' | 'params'>): string =>
  JSON.stringify([
    page.view,
    Object.fromEntries(
      Object.entries(page.params)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  ]);
/** Whether a page lists search results, so leaving a project for it can say "back to search results". */
export const isSearchResults = (page: Pick<Destination, 'view' | 'params'> | null): boolean =>
  page?.view === 'discover' && Boolean(page.params.query?.trim());
export function sectionOf(page: Pick<Destination, 'view' | 'params'>): Section {
  if (page.params.section) return page.params.section;
  if (page.view === 'issue' || page.view === 'issues') return 'issues';
  if (page.view === 'pulls') return 'pulls';
  if (page.view === 'discover' || page.view === 'public-project') return 'discover';
  if (page.view === 'profile' || page.view === 'starred') return 'profile';
  if (page.view === 'home' || page.view === 'recent-history') return 'home';
  return page.view === 'settings' ? 'settings' : 'projects';
}
export function navigationReducer(state: NavigationState, action: NavigationAction): NavigationState {
  if (action.type === 'remove-repository') {
    const keep = (page: Destination) => page.params.repo?.toLowerCase() !== action.repo.toLowerCase();
    const before = state.entries.slice(0, state.index).filter(keep),
      after = state.entries.slice(state.index + 1).filter(keep);
    const current = state.entries[state.index]!;
    const page: Destination = keep(current) ? current : { view: 'projects', params: {}, scrollTop: 0 };
    return {
      entries: [...before, page, ...after],
      index: before.length,
      sections: Object.fromEntries(Object.entries(state.sections).filter(([, page]) => keep(page))),
    };
  }
  const entries = [...state.entries],
    current = { ...entries[state.index]!, scrollTop: Math.max(0, action.scrollTop) };
  entries[state.index] = current;
  const sections = { ...state.sections, [sectionOf(current)]: current };
  if (action.type === 'scroll') return { ...state, entries, sections };
  if (action.type === 'move')
    return { entries, sections, index: Math.max(0, Math.min(entries.length - 1, state.index + action.delta)) };
  if (action.type === 'params') {
    entries[state.index] = {
      ...current,
      params: { ...current.params, ...action.params },
      scrollTop: action.resetScroll ? 0 : current.scrollTop,
    };
    return { ...state, entries, sections };
  }
  const page: Destination =
    action.type === 'sidebar'
      ? sectionOf(current) !== action.section && sections[action.section]
        ? {
            ...sections[action.section]!,
            params: {
              ...sections[action.section]!.params,
              ...(sections[action.section]!.view === 'public-project'
                ? { outerBoundary: sections[action.section]!.params.nestedKey }
                : {}),
            },
          }
        : { view: action.section, params: {}, scrollTop: 0 }
      : action.page;
  if (pageIdentity(page) === pageIdentity(current)) return { ...state, entries, sections };
  if (action.type === 'visit' && action.replace) {
    entries[state.index] = page;
    return { ...state, entries, sections };
  }
  const next = [...entries.slice(0, state.index + 1), page].slice(-51);
  return { entries: next, index: next.length - 1, sections };
}
