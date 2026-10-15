import { describe, expect, it } from 'vitest';
import { needsWelcome } from './onboarding';
describe('first launch', () => {
  it('welcomes only signed-out users who have not chosen', () => {
    expect(needsWelcome('signed-out', null)).toBe(true);
    for (const state of ['offline', 'expired', 'signed-in']) expect(needsWelcome(state, null)).toBe(false);
    expect(needsWelcome('signed-out', 'demo')).toBe(false);
    expect(needsWelcome('signed-out', 'login')).toBe(false);
  });
});
