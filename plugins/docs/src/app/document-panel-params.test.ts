import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLibraryAutosave,
  isHtmlLibraryPath,
  parseDocumentPanelParams
} from './document-panel-params.js';

describe('parseDocumentPanelParams', () => {
  it('requires a confined library path and a project id for project scope', () => {
    expect(parseDocumentPanelParams(null)).toBeNull();
    expect(parseDocumentPanelParams({ path: '../x.md', scope: 'project', projectId: 'p1' })).toBeNull();
    expect(parseDocumentPanelParams({ path: 'findings/auth.md', scope: 'project' })).toBeNull();
    expect(parseDocumentPanelParams({
      path: 'findings/auth.md',
      scope: 'project',
      projectId: 'p1',
      title: 'Auth'
    })).toEqual({
      path: 'findings/auth.md',
      scope: 'project',
      projectId: 'p1',
      title: 'Auth'
    });
  });

  it('allows global docs without a project id', () => {
    expect(parseDocumentPanelParams({ path: 'ideas/note.html', scope: 'global' })).toEqual({
      path: 'ideas/note.html',
      scope: 'global',
      title: 'note.html'
    });
  });
});

describe('isHtmlLibraryPath', () => {
  it('detects html extensions', () => {
    expect(isHtmlLibraryPath('ideas/note.html')).toBe(true);
    expect(isHtmlLibraryPath('ideas/note.htm')).toBe(true);
    expect(isHtmlLibraryPath('findings/auth.md')).toBe(false);
  });
});

describe('createLibraryAutosave', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes after the debounce window', () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => undefined);
    const saver = createLibraryAutosave(write, 700);
    saver.schedule('one');
    saver.schedule('two');
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(700);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('two');
  });

  it('flushes a pending write immediately', () => {
    vi.useFakeTimers();
    const write = vi.fn(async () => undefined);
    const saver = createLibraryAutosave(write, 700);
    saver.schedule('draft');
    saver.flush();
    expect(write).toHaveBeenCalledWith('draft');
  });
});
