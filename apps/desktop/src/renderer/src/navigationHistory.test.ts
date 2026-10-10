import { describe, expect, it } from 'vitest';
import { NavigationHistory } from './navigationHistory';

describe('browsing history', () => {
  it('finishes a back transition even when its target has the same page key', () => {
    const history = new NavigationHistory();
    history.record('list', () => {});
    history.record('deleted', () => {});
    history.record('list', () => {});
    history.prune((key) => key !== 'deleted');
    history.back(() => {});
    history.record('list', () => {});
    expect(history.record('new-project', () => {})).toBe(1);
  });

  it('removes deleted targets without losing unrelated pages', () => {
    const history = new NavigationHistory();
    let restored = '';
    for (const key of ['list', 'deleted/project', 'other/project', 'deleted/issue', 'delete']) {
      history.record(key, () => { restored = key; });
    }
    expect(history.prune((key) => !key.startsWith('deleted/'))).toBe(2);
    history.replaceNext();
    history.record('list', () => {});
    history.back(() => {});
    expect(restored).toBe('other/project');
    history.record(restored, () => {});
    history.back(() => {});
    expect(restored).toBe('list');
  });

  it('does not add a stale target when restoration uses a valid fallback', () => {
    const history = new NavigationHistory();
    history.record('deleted', () => {});
    history.record('current', () => {});
    history.back(() => {});
    expect(history.record('list', () => {})).toBe(0);
  });

  it('does not return to a submitted operation or loop through a fallback', () => {
    const history = new NavigationHistory();
    let restored = '';
    history.record('project', () => { restored = 'project'; });
    history.record('publish', () => { restored = 'publish'; });
    history.replaceNext();
    history.record('release', () => { restored = 'release'; });
    history.back(() => { restored = 'fallback'; });
    expect(restored).toBe('project');
    history.record('project', () => {});
    history.back(() => { restored = 'fallback'; });
    expect(history.record('fallback', () => {})).toBe(0);
    history.back(() => { restored = 'empty'; });
    expect(restored).toBe('empty');
  });
  it('returns through every page and does not add restored pages again', () => {
    const history = new NavigationHistory();
    let page = 'search';
    for (const next of ['search', 'profile', 'project', 'issue', 'release']) {
      page = next;
      history.record(next, () => { page = next; });
    }
    for (const expected of ['issue', 'project', 'profile', 'search']) {
      history.back(() => { page = 'fallback'; });
      expect(page).toBe(expected);
      history.record(page, () => { page = expected; });
    }
    history.back(() => { page = 'fallback'; });
    expect(page).toBe('fallback');
  });

  it('keeps the latest state on the same page without creating typing history', () => {
    const history = new NavigationHistory();
    let restored = '';
    history.record('search', () => { restored = 'first'; });
    history.record('search', () => { restored = 'writer, page 3, scroll 520'; });
    expect(history.record('project', () => {})).toBe(1);
    history.back(() => {});
    expect(restored).toBe('writer, page 3, scroll 520');
  });

  it('keeps revisits to the same project at different positions in the chain', () => {
    const history = new NavigationHistory();
    const restored: string[] = [];
    for (const [key, state] of [['project', 'first visit'], ['issue', 'issue'], ['project', 'second visit'], ['release', 'release']]) {
      history.record(key!, () => restored.push(state!));
    }
    history.back(() => {});
    history.record('project', () => restored.push('second visit'));
    history.back(() => {});
    history.record('issue', () => restored.push('issue'));
    history.back(() => {});
    expect(restored).toEqual(['second visit', 'issue', 'first visit']);
  });

  it('bounds history and uses the fallback only after all retained pages', () => {
    const history = new NavigationHistory(2);
    const restored: string[] = [];
    for (const key of ['a', 'b', 'c', 'd']) history.record(key, () => restored.push(key));
    for (const key of ['c', 'b']) {
      history.back(() => restored.push('fallback'));
      history.record(key, () => {});
    }
    history.back(() => restored.push('fallback'));
    expect(restored).toEqual(['c', 'b', 'fallback']);
  });
});
