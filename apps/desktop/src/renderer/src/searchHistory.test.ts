import { describe, expect, it } from 'vitest';
import { historyKey, readSearchHistory, rememberSearch } from './searchHistory';

describe('search history', () => {
  it('keeps ten recent distinct searches per scope', () => {
    let history = [] as ReturnType<typeof rememberSearch>;
    for (let index = 0; index < 12; index++) history = rememberSearch(history, `project ${index}`, 'public');
    history = rememberSearch(history, ' project 10 ', 'public');
    expect(history).toHaveLength(10);
    expect(history[0]).toEqual({ query: 'project 10', scope: 'public' });
    expect(history.some((entry) => entry.query === 'project 0')).toBe(false);
  });

  it('ignores invalid persisted entries and separates account keys', () => {
    expect(historyKey('alice')).not.toBe(historyKey('bob'));
    const storage = { getItem: () => JSON.stringify([{ query: 'valid', scope: 'mine' }, { query: 'bad', scope: 'unsafe' }]) };
    expect(readSearchHistory(storage, 'alice')).toEqual([{ query: 'valid', scope: 'mine' }]);
  });

  it('keeps user searches separate from project searches', () => {
    const history = rememberSearch(rememberSearch([], 'writer', 'public'), 'writer', 'users');
    expect(readSearchHistory({ getItem: () => JSON.stringify(history) }, 'alice')).toEqual([
      { query: 'writer', scope: 'users' }, { query: 'writer', scope: 'public' },
    ]);
  });
});
