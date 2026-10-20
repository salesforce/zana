import { describe, expect, it } from 'vitest';
import { threadViewDocumentTitle, threadViewForward } from './thread-view-state.js';

describe('threadViewDocumentTitle', () => {
  it('names the thread, its project and the app', () => {
    expect(threadViewDocumentTitle('Fix login', 'Acme', 'Zana')).toBe('Fix login — Acme — Zana');
    expect(threadViewDocumentTitle('  ', undefined, 'Zana')).toBe('Agent — Zana');
    expect(threadViewDocumentTitle(undefined, 'Acme', 'Zana')).toBe('Agent — Acme — Zana');
  });
});

describe('threadViewForward', () => {
  it('stays put on the window home path', () => {
    expect(threadViewForward('/', '/')).toBeNull();
  });

  it('shows another thread in main and keeps this window', () => {
    expect(threadViewForward('/projects/p-1/threads/t-2', '/')).toEqual({ path: '/projects/p-1/threads/t-2', closeWindow: false });
  });

  it('closes the window when the thread leaves for a list', () => {
    expect(threadViewForward('/agents', '/')).toEqual({ path: '/agents', closeWindow: true });
  });
});
