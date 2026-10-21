import { describe, expect, it } from 'vitest';
import { findUnscopedWindow, isUnscopedEntry, isUnscopedRegistration } from './main-window-registry.js';

const win = (destroyed = false) => ({ isDestroyed: () => destroyed });

describe('main window registry', () => {
  it('rules out project, plugin view and thread view windows', () => {
    expect(isUnscopedEntry({})).toBe(true);
    expect(isUnscopedEntry({ projectId: 'p-1' })).toBe(false);
    expect(isUnscopedEntry({ threadView: { threadId: 't-1' } })).toBe(false);
  });

  it('matches a registration only for the same, unscoped window', () => {
    const main = win();
    expect(isUnscopedRegistration({ win: main }, main)).toBe(true);
    expect(isUnscopedRegistration({ win: main }, win())).toBe(false);
    expect(isUnscopedRegistration(undefined, main)).toBe(false);
    expect(isUnscopedRegistration({ win: main, threadView: { threadId: 't-1' } }, main)).toBe(false);
  });

  it('finds the first live unscoped window', () => {
    const main = win();
    expect(findUnscopedWindow([{ win: win(), threadView: { threadId: 't-1' } }, { win: win(true) }, { win: main }])).toBe(main);
    expect(findUnscopedWindow([{ win: win(), projectId: 'p-1' }])).toBeNull();
  });
});
