import { describe, expect, it } from 'vitest';
import { resolveShellLayout } from './shellLayout.js';

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

  it('uses a focused settings rail only in the main window', () => {
    expect(resolveShellLayout('settings', false)).toEqual({ rail: 'settings' });
    expect(resolveShellLayout('settings', true)).toEqual({ rail: 'primary' });
  });

  it('keeps the extension rail global while project windows use their own rail', () => {
    expect(resolveShellLayout('extensions', false)).toEqual({ rail: 'extensions' });
    expect(resolveShellLayout('extensions', true)).toEqual({ rail: 'primary' });
  });
});
