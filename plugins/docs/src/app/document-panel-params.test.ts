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

  it('resolves a late owning project without overriding an explicit document scope', () => {
    expect(parseDocumentPanelParams({ path: 'note.md' }, ' owner ')).toEqual({ path: 'note.md', title: 'note.md', scope: 'project', projectId: 'owner' });
    expect(parseDocumentPanelParams({ path: 'note.md', projectId: 'explicit' }, 'owner')?.projectId).toBe('explicit');
    expect(parseDocumentPanelParams({ path: 'note.md' }, ' ')).toBeNull();
    expect(parseDocumentPanelParams({ path: 'note.md', scope: 'global' }, 'owner')).not.toHaveProperty('projectId');
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
  it('serializes writes and coalesces later drafts until the preceding revision is acknowledged', async () => {
    vi.useFakeTimers(); let release!: () => void;
    const write = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; })).mockResolvedValue(undefined);
    const saver = createLibraryAutosave(write);
    saver.schedule('first'); await vi.advanceTimersByTimeAsync(700);
    saver.schedule('second'); await vi.advanceTimersByTimeAsync(700);
    saver.schedule('latest'); saver.flush(); expect(write).toHaveBeenCalledTimes(1);
    release(); await vi.advanceTimersByTimeAsync(0);
    expect(write.mock.calls.map(call => call[0])).toEqual(['first', 'latest']);
  });
  it('stops on a conflict without retrying and cancels a pending draft', async () => {
    vi.useFakeTimers(); const failed = new Error('conflict');
    const write = vi.fn().mockRejectedValue(failed), onError = vi.fn();
    const saver = createLibraryAutosave(write, 700, onError);
    saver.schedule('first'); await vi.advanceTimersByTimeAsync(700);
    saver.schedule('second'); await vi.advanceTimersByTimeAsync(700); saver.flush();
    expect(write).toHaveBeenCalledOnce(); expect(onError).toHaveBeenCalledWith(failed);
    const fresh = createLibraryAutosave(write); fresh.schedule('cancelled'); fresh.cancel();
    await vi.advanceTimersByTimeAsync(700); expect(write).toHaveBeenCalledOnce();
  });
});
