import { describe, expect, it } from 'vitest';
import { projectPresentation } from './projectPresentation';

describe('project state shown across local cards and project details', () => {
  it('never declares an unscanned or failed folder saved', () => {
    expect(projectPresentation().state).toBe('checking');
    expect(projectPresentation({ files: [], needsReview: false }, undefined, true).state).toBe('unavailable');
    expect(projectPresentation({ files: [], needsReview: false }).state).toBe('checking');
  });
  it('keeps a newer cloud version visible when the local folder is clean', () => {
    expect(projectPresentation({ files: [], needsReview: false }, { state: 'ready', files: [], changedFiles: 1 }).state).toBe('remote');
    expect(projectPresentation({ files: [], needsReview: false }, { state: 'current', files: [], changedFiles: 0 }).state).toBe('saved');
  });
  it('prioritizes a request for confirmation over saved or remote status', () => {
    expect(projectPresentation({ files: [], needsReview: true }).state).toBe('review');
    expect(projectPresentation({ files: [], needsReview: false }, { state: 'blocked', files: [], changedFiles: 0 }).state).toBe('unavailable');
  });
});
