import { describe, expect, it } from 'vitest';
import { parseProjectAddress } from './projectAddress';

describe('project address entry', () => {
  it('accepts a GitHub project address and links inside that project', () => {
    expect(parseProjectAddress('https://github.com/driceroland/Search')).toEqual({ owner: 'driceroland', name: 'Search' });
    expect(parseProjectAddress('github.com/FuFu-Flash/EasyHub/tree/main')).toEqual({ owner: 'FuFu-Flash', name: 'EasyHub' });
    expect(parseProjectAddress('git@github.com:FuFu-Flash/EasyHub.git')).toEqual({ owner: 'FuFu-Flash', name: 'EasyHub' });
  });
  it('does not turn ordinary searches or other websites into project navigation', () => {
    expect(parseProjectAddress('Search')).toBeNull();
    expect(parseProjectAddress('https://example.com/driceroland/Search')).toBeNull();
    expect(parseProjectAddress('https://github.com/driceroland')).toBeNull();
    expect(parseProjectAddress('https://github.com/../Search')).toBeNull();
  });
});
