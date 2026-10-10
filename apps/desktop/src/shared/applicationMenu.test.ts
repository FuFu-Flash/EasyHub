import { describe, expect, it } from 'vitest';
import { canRunMenuCommand, isMenuCommand, isMenuState, type MenuState } from './applicationMenu';

const signedIn: MenuState = { language: 'zh', signedIn: true, busy: false, modalOpen: false, demoOnly: false };

describe('application menu IPC contract', () => {
  it('recognizes complete exact command names rather than arbitrary renderer input', () => {
    expect(isMenuCommand('proxy-settings')).toBe(true);
    expect(isMenuCommand('reviews')).toBe(true);
    for (const value of [null, {}, ['home'], 'Home', 'home ', 'open-external', 'easyhub:home']) {
      expect(isMenuCommand(value)).toBe(false);
    }
  });

  it('requires every state field with exact language and boolean values', () => {
    expect(isMenuState(signedIn)).toBe(true);
    expect(isMenuState({ ...signedIn, language: 'en' })).toBe(true);
    expect(isMenuState({ ...signedIn, extra: false })).toBe(false);
    expect(isMenuState({ ...signedIn, modalOpen: 'false' })).toBe(false);
    expect(isMenuState({ language: 'zh', signedIn: true, busy: false, modalOpen: false })).toBe(false);
    expect(isMenuState(Object.create(signedIn))).toBe(false);
  });

  it('requires a live account for remote views without blocking local Demo tools', () => {
    for (const command of ['discover', 'reviews', 'starred', 'refresh'] as const) {
      expect(canRunMenuCommand(command, signedIn)).toBe(true);
      expect(canRunMenuCommand(command, { ...signedIn, signedIn: false })).toBe(false);
      expect(canRunMenuCommand(command, { ...signedIn, demoOnly: true })).toBe(false);
    }
    for (const command of ['profile', 'new-project', 'add-folder', 'download-project'] as const) {
      expect(canRunMenuCommand(command, { ...signedIn, signedIn: false, demoOnly: true })).toBe(true);
    }
  });

  it('keeps navigation available while busy and disables all application commands while a dialog is open', () => {
    expect(canRunMenuCommand('home', { ...signedIn, busy: true })).toBe(true);
    expect(canRunMenuCommand('new-project', { ...signedIn, busy: true })).toBe(false);
    expect(canRunMenuCommand('refresh', { ...signedIn, busy: true })).toBe(false);
    expect(canRunMenuCommand('settings', { ...signedIn, modalOpen: true })).toBe(false);
    expect(canRunMenuCommand('home', { ...signedIn, modalOpen: true })).toBe(false);
  });
});
