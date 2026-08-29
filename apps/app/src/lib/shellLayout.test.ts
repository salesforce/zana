import { describe, expect, it } from 'vitest';
import { keepsProjectFocusRail, resolveShellLayout, shellTitlebarLabel } from './shellLayout.js';

describe('resolveShellLayout', () => {
  it.each(['inbox', 'scheduler', 'home', 'agents', 'projects', 'followups'])(
    'uses the primary rail for %s (content is always full)',
    (nav) => {
      expect(resolveShellLayout(nav, false)).toEqual({ rail: 'primary' });
    }
  );

  it('gives list-less destinations the same primary rail', () => {
    expect(resolveShellLayout('suggestions', false)).toEqual({ rail: 'primary' });
    expect(resolveShellLayout('module-id', false)).toEqual({ rail: 'primary' });
  });

  it('uses a focused settings rail only when the project rail is not locked', () => {
    expect(resolveShellLayout('settings', false)).toEqual({ rail: 'settings' });
    expect(resolveShellLayout('settings', true)).toEqual({ rail: 'primary' });
  });

  it('keeps the extension rail global while a locked project rail stays put', () => {
    expect(resolveShellLayout('extensions', false)).toEqual({ rail: 'extensions' });
    expect(resolveShellLayout('extensions', true)).toEqual({ rail: 'primary' });
  });
});

describe('keepsProjectFocusRail', () => {
  it('keeps the project rail for workspace, inbox, suggestions, and settings', () => {
    expect(keepsProjectFocusRail('projects', 'proj-1')).toBe(true);
    expect(keepsProjectFocusRail('inbox', 'proj-1')).toBe(true);
    expect(keepsProjectFocusRail('suggestions', 'proj-1')).toBe(true);
    expect(keepsProjectFocusRail('settings', 'proj-1')).toBe(true);
  });

  it('releases the project rail for global destinations', () => {
    expect(keepsProjectFocusRail('home', 'proj-1')).toBe(false);
    expect(keepsProjectFocusRail('agents', 'proj-1')).toBe(false);
    expect(keepsProjectFocusRail('scheduler', 'proj-1')).toBe(false);
    expect(keepsProjectFocusRail('extensions', 'proj-1')).toBe(false);
  });

  it('never keeps the project rail when nothing is focused', () => {
    expect(keepsProjectFocusRail('projects', null)).toBe(false);
    expect(keepsProjectFocusRail('inbox', undefined)).toBe(false);
  });
});

describe('shellTitlebarLabel', () => {
  it('shows the project name when the project rail is locked', () => {
    expect(shellTitlebarLabel('zana-command-center', true)).toBe('zana-command-center');
  });

  it('falls back to Zana on the global shell', () => {
    expect(shellTitlebarLabel('zana-command-center', false)).toBe('Zana');
    expect(shellTitlebarLabel(null, true)).toBe('Zana');
    expect(shellTitlebarLabel(undefined, false)).toBe('Zana');
  });
});
