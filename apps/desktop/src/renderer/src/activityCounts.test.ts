import { describe, expect, it } from 'vitest';
import { noticeGroup, sumActivity, unreadNotifications } from './activityCounts';
describe('consistent activity counts', () => {
  it('does not count missing data as zero or combine issues and requests', () => {
    const counts = { 1: { issues: 2, closedIssues: 3, pullRequests: 4, closedPullRequests: 1 } };
    expect(sumActivity([{ id: 1 }], counts, 'issues')).toBe(2);
    expect(sumActivity([{ id: 1 }], counts, 'pullRequests')).toBe(4);
    expect(sumActivity([{ id: 1 }, { id: 2 }], counts, 'issues')).toBe(null);
    expect(sumActivity([], {}, 'issues')).toBe(0);
    expect(unreadNotifications(2, 1)).toBe(3);
    expect(noticeGroup('issues-1')).toBe('issues');
    expect(noticeGroup('pulls-1')).toBe('pulls');
  });
});
