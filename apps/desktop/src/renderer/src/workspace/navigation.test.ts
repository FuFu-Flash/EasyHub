import { describe, expect, it } from 'vitest';
import type { NavigationState, PageParams, View } from './navigation';
import { initialNavigation, navigationReducer, pageIdentity } from './navigation';
const visit = (state: NavigationState, view: View, params: PageParams = {}, scrollTop = 0, replace = false) =>
  navigationReducer(state, { type: 'visit', page: { view, params, scrollTop: 0 }, scrollTop, replace });
describe('parameter-only workspace history', () => {
  it('returns through every actual origin and restores independent scroll positions', () => {
    let state = visit(initialNavigation(), 'project', { repo: 'me/one' }, 110);
    state = visit(state, 'issues', { repo: 'me/one' }, 220);
    state = visit(state, 'issue', { repo: 'me/one', number: 7 }, 330);
    state = navigationReducer(state, { type: 'move', delta: -1, scrollTop: 440 });
    expect(state.entries[state.index]).toEqual({ view: 'issues', params: { repo: 'me/one' }, scrollTop: 330 });
    state = navigationReducer(state, { type: 'move', delta: -1, scrollTop: 330 });
    expect(state.entries[state.index]?.scrollTop).toBe(220);
    state = navigationReducer(state, { type: 'move', delta: 1, scrollTop: 220 });
    state = navigationReducer(state, { type: 'move', delta: 1, scrollTop: 330 });
    expect(state.entries[state.index]).toEqual({
      view: 'issue',
      params: { repo: 'me/one', number: 7 },
      scrollTop: 440,
    });
  });
  it('restores the last destination of a sidebar section and keeps chronological history', () => {
    let state = visit(initialNavigation(), 'public-project', {
      repo: 'writer/demo',
      section: 'discover',
      nestedKey: 'issue:7',
    });
    state = navigationReducer(state, { type: 'sidebar', section: 'settings', scrollTop: 680 });
    state = navigationReducer(state, { type: 'sidebar', section: 'discover', scrollTop: 120 });
    expect(state.entries[state.index]).toEqual({
      view: 'public-project',
      params: { repo: 'writer/demo', section: 'discover', nestedKey: 'issue:7', outerBoundary: 'issue:7' },
      scrollTop: 680,
    });
    state = navigationReducer(state, { type: 'move', delta: -1, scrollTop: 680 });
    expect(state.entries[state.index]).toEqual({ view: 'settings', params: {}, scrollTop: 120 });
  });
  it('updates search and paging parameters without adding dozens of visits', () => {
    let state = visit(initialNavigation(), 'discover');
    for (let page = 1; page <= 20; page++)
      state = navigationReducer(state, {
        type: 'params',
        params: { query: 'editor', page, scope: 'projects' },
        scrollTop: 30,
      });
    expect(state.entries).toHaveLength(2);
    state = visit(state, 'public-project', { repo: 'writer/demo' }, 390);
    state = navigationReducer(state, { type: 'move', delta: -1, scrollTop: 0 });
    expect(state.entries[state.index]?.params).toMatchObject({ query: 'editor', page: 20 });
  });
  it('removes transferred repositories from previous, future, current and sidebar destinations', () => {
    let state = visit(initialNavigation(), 'project', { repo: 'Me/One' });
    state = navigationReducer(state, { type: 'sidebar', section: 'settings', scrollTop: 5 });
    state = visit(state, 'project', { repo: 'me/one' });
    state = navigationReducer(state, { type: 'remove-repository', repo: 'me/one' });
    expect(state.entries.some((entry) => entry.params.repo)).toBe(false);
    expect(Object.values(state.sections).some((entry) => entry.params.repo)).toBe(false);
    expect(state.entries[state.index]?.view).toBe('projects');
  });
  it('replaces a completed publication instead of retaining an actionable submit page', () => {
    let state = visit(initialNavigation(), 'new-release', { repo: 'me/one' });
    state = visit(state, 'downloads', { repo: 'me/one', tag: 'v1.0.0' }, 0, true);
    expect(state.entries.map((entry) => entry.view)).toEqual(['home', 'downloads']);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
    for (const entry of state.entries) expect(Object.keys(entry).sort()).toEqual(['params', 'scrollTop', 'view']);
  });
  it('discards the forward branch on a new visit, bounds history, and uses stable parameter identities', () => {
    let state = initialNavigation();
    for (let number = 1; number <= 80; number++) state = visit(state, 'issue', { repo: 'me/one', number });
    expect(state.entries).toHaveLength(51);
    state = navigationReducer(state, { type: 'move', delta: -20, scrollTop: 0 });
    state = visit(state, 'settings');
    expect(state.index).toBe(state.entries.length - 1);
    expect(pageIdentity({ view: 'issue', params: { number: 7, repo: 'me/one' } })).toBe(
      pageIdentity({ view: 'issue', params: { repo: 'me/one', number: 7, tag: undefined } }),
    );
  });
  it('starts a new result page at the top without mutating an earlier destination', () => {
    const initial = visit(initialNavigation(), 'discover', { page: 1 });
    const state = navigationReducer(initial, {
      type: 'params',
      params: { page: 2 },
      scrollTop: 1900,
      resetScroll: true,
    });
    expect(state.entries[state.index]?.scrollTop).toBe(0);
    expect(initial.entries[initial.index]?.params.page).toBe(1);
    expect(state.entries[state.index]?.params.page).toBe(2);
  });
});
