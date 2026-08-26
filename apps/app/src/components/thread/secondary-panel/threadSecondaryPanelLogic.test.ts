import { describe, expect, it, vi } from 'vitest';
import {
  contentFromLocalRead,
  copyText,
  createSecondaryPanelCommands,
  environmentLabel,
  environmentNameFromList,
  invokeWebviewMethod,
  isPreviewImagePath,
  matchNewTabFiles,
  newTabFileTitle,
  normalizeBrowserUrl,
  onThreadPanelTerminalUnmount,
  previewKind,
  shouldClearThreadPanelTerminal,
  widthFromPointer,
  loadEnvironmentName,
  loadFilePreview,
  loadWalkedFiles,
  loadWorkspaceMeta,
  applyIfCurrent,
  applyPreviewResult,
  attachColumnResize,
  commitBrowserUrl,
  hydrateThreadInfo,
  startColumnResize
} from './threadSecondaryPanelLogic.js';
import { emptySecondaryPanelState } from './threadSecondaryPanelState.js';

describe('threadSecondaryPanelLogic', () => {
  it('labels environments', () => {
    expect(environmentLabel(false)).toBe('Local');
    expect(environmentLabel(true)).toBe('This checkout');
    expect(environmentLabel(false, ' Staging ')).toBe('Staging');
    expect(environmentNameFromList([{ id: 'e1', name: 'Dev' }], 'e1')).toBe('Dev');
    expect(environmentNameFromList([{ id: 'e1' }], 'missing')).toBeNull();
  });

  it('re-exports copyText for thread callers', async () => {
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      await copyText('/tmp/proj');
      expect(writeText).toHaveBeenCalledWith('/tmp/proj');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('normalizes browser urls and invokes webview methods', () => {
    expect(normalizeBrowserUrl('https://zana.ai')).toBe('https://zana.ai');
    expect(normalizeBrowserUrl('zana.ai')).toBe('https://zana.ai');
    const view = { goBack: vi.fn(), goForward: vi.fn(), reload: vi.fn() };
    invokeWebviewMethod(view, 'goBack');
    invokeWebviewMethod(view, 'goForward');
    invokeWebviewMethod(view, 'reload');
    invokeWebviewMethod(null, 'reload');
    expect(view.goBack).toHaveBeenCalled();
    expect(view.goForward).toHaveBeenCalled();
    expect(view.reload).toHaveBeenCalled();
  });

  it('classifies file previews and local reads', () => {
    expect(isPreviewImagePath('a.png')).toBe(true);
    expect(isPreviewImagePath('a.ts')).toBe(false);
    expect(contentFromLocalRead({ ok: true, content: 'hi' })).toBe('hi');
    expect(contentFromLocalRead({ ok: true })).toBe('');
    expect(contentFromLocalRead({ ok: false })).toBeNull();
    expect(contentFromLocalRead(null)).toBeNull();
    expect(previewKind('/tmp/a.png', 'data:image/png;base64,xx')).toBe('image');
    expect(previewKind('/tmp/a.ts', 'const x = 1')).toBe('text');
  });

  it('filters New Tab files and titles them', () => {
    const files = [
      { path: '/tmp/README.md', rel: 'README.md' },
      { path: '/tmp/src/a.ts', rel: 'src/a.ts' }
    ];
    expect(matchNewTabFiles(files, '')).toHaveLength(2);
    expect(matchNewTabFiles(files, 'readme')[0]?.rel).toBe('README.md');
    expect(matchNewTabFiles(files, 'zzz')).toEqual([]);
    expect(newTabFileTitle(files[0]!)).toBe('README.md');
    expect(newTabFileTitle({ path: '/tmp/orphan.ts' })).toBe('orphan.ts');
  });

  it('computes resize width and terminal cleanup', () => {
    expect(widthFromPointer(800, { right: 1200, width: 1000 })).toEqual({
      widthPx: 400,
      containerWidthPx: 1000
    });
    expect(shouldClearThreadPanelTerminal({ sessionId: 's1' }, 's1')).toBe(true);
    expect(shouldClearThreadPanelTerminal({ sessionId: 's2' }, 's1')).toBe(false);
    expect(shouldClearThreadPanelTerminal(null, 's1')).toBe(false);
    expect(commitBrowserUrl('zana.ai', (url) => {
      expect(url).toBe('https://zana.ai');
    })).toBe('https://zana.ai');
    const listeners = new Map<string, Array<(ev: { clientX: number }) => void>>();
    const classes = new Set<string>();
    const resized: Array<[number, number]> = [];
    attachColumnResize({
      getBox: () => ({ right: 1200, width: 1000 }),
      onResize: (widthPx, containerWidthPx) => resized.push([widthPx, containerWidthPx]),
      addBodyClass: (name) => { classes.add(name); },
      removeBodyClass: (name) => { classes.delete(name); },
      on: (type, fn) => {
        const list = listeners.get(type) ?? [];
        list.push(fn);
        listeners.set(type, list);
      },
      off: (type, fn) => {
        listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== fn));
      }
    });
    expect(classes.has('resizing-col')).toBe(true);
    listeners.get('mousemove')?.[0]?.({ clientX: 800 });
    expect(resized).toEqual([[400, 1000]]);
    attachColumnResize({
      getBox: () => undefined,
      onResize: (widthPx, containerWidthPx) => resized.push([widthPx, containerWidthPx]),
      addBodyClass: () => undefined,
      removeBodyClass: () => undefined,
      on: (type, fn) => {
        const list = listeners.get(type) ?? [];
        list.push(fn);
        listeners.set(type, list);
      },
      off: () => undefined
    });
    listeners.get('mousemove')?.[1]?.({ clientX: 10 });
    expect(resized).toEqual([[400, 1000]]);
    listeners.get('mouseup')?.[0]?.({ clientX: 0 });
    expect(classes.has('resizing-col')).toBe(false);
    const prevented: string[] = [];
    startColumnResize(
      { preventDefault: () => { prevented.push('yes'); } },
      () => ({ getBoundingClientRect: () => ({ right: 900, width: 800 }) }),
      (widthPx, containerWidthPx) => resized.push([widthPx, containerWidthPx]),
      (name) => { classes.add(name); },
      (name) => { classes.delete(name); },
      (type, fn) => {
        const list = listeners.get(type) ?? [];
        list.push(fn);
        listeners.set(type, list);
      },
      (type, fn) => {
        listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== fn));
      }
    );
    expect(prevented).toEqual(['yes']);
    expect(classes.has('resizing-col')).toBe(true);
    applyIfCurrent(true, 'x', () => { throw new Error('cancelled'); });
    const seen: string[] = [];
    applyIfCurrent(false, 'ok', (value) => { seen.push(value); });
    expect(seen).toEqual(['ok']);
    applyPreviewResult(true, { content: 'nope' }, () => { throw new Error('cancelled'); }, () => { throw new Error('cancelled'); });
    applyPreviewResult(false, { error: 'boom' }, (error) => { seen.push(error); }, () => { throw new Error('content'); });
    applyPreviewResult(false, { content: 'hi' }, () => { throw new Error('error'); }, (content) => { seen.push(content); });
    expect(seen).toEqual(['ok', 'boom', 'hi']);
  });

  it('applies secondary panel commands through update', () => {
    let state = emptySecondaryPanelState();
    const commands = createSecondaryPanelCommands((recipe) => {
      state = recipe(state);
    });
    commands.open();
    expect(state.isOpen).toBe(true);
    commands.selectPin('diff');
    expect(state.activeId).toBe('diff');
    commands.openNewTab();
    expect(state.tabs).toHaveLength(1);
    const tabId = state.tabs[0]!.id;
    commands.activateTab(tabId);
    expect(state.activeId).toBe(tabId);
    commands.patchTab(tabId, { title: 'Renamed' });
    expect(state.tabs[0]?.title).toBe('Renamed');
    commands.addTab({ kind: 'browser', title: 'Browser', url: 'https://example.com' });
    expect(state.tabs.some((tab) => tab.kind === 'browser')).toBe(true);
    commands.setWidth(480, 1200);
    expect(state.widthPx).toBe(480);
    commands.toggleMaximized();
    expect(state.isMaximized).toBe(true);
    commands.closeTab(tabId);
    commands.close();
    expect(state.isOpen).toBe(false);
  });

  it('loads environment names and workspace meta', async () => {
    await expect(loadEnvironmentName(async () => [{ id: 'e1', name: 'Dev' }], 'p', 'e1')).resolves.toBe('Dev');
    await expect(loadEnvironmentName(async () => { throw new Error('nope'); }, 'p', 'e1')).resolves.toBeNull();
    await expect(loadWorkspaceMeta(
      async () => ({ dirty: true }),
      async () => ({ pullRequest: { number: 1 } }),
      'e1'
    )).resolves.toEqual({ status: { dirty: true }, pullRequest: { number: 1 } });
    await expect(loadWorkspaceMeta(
      async () => { throw new Error('status'); },
      async () => { throw new Error('pr'); },
      'e1'
    )).resolves.toEqual({ status: null, pullRequest: null });
  });

  it('loads file previews and walked files, and clears the terminal unmount', async () => {
    await expect(loadFilePreview(
      async () => ({ ok: true, content: 'hi' }),
      async () => ({ content: 'host' }),
      't',
      '/a.ts'
    )).resolves.toEqual({ content: 'hi' });
    await expect(loadFilePreview(
      async () => ({ ok: false }),
      async () => ({ content: 'host' }),
      't',
      '/a.ts'
    )).resolves.toEqual({ content: 'host' });
    await expect(loadFilePreview(
      async () => { throw new Error('local'); },
      async () => { throw new Error('boom'); },
      't',
      '/a.ts'
    )).resolves.toEqual({ error: 'boom' });
    await expect(loadFilePreview(
      async () => { throw new Error('local'); },
      async () => { throw 'x'; },
      't',
      '/a.ts'
    )).resolves.toEqual({ error: 'Could not read file' });
    await expect(loadFilePreview(
      async () => ({ ok: false }),
      undefined,
      undefined,
      '/a.ts'
    )).resolves.toEqual({ error: 'Could not read file' });
    await expect(loadFilePreview(
      async () => { throw new Error('local'); },
      undefined,
      't',
      '/a.ts'
    )).resolves.toEqual({ error: 'Could not read file' });
    await expect(loadWalkedFiles(undefined, '/tmp')).resolves.toEqual([]);
    await expect(loadWalkedFiles(async () => [{ path: '/tmp/a.ts', rel: 'a.ts' }], '/tmp')).resolves.toEqual([
      { path: '/tmp/a.ts', rel: 'a.ts' }
    ]);
    await expect(loadWalkedFiles(async () => { throw new Error('walk'); }, '/tmp')).resolves.toEqual([]);
    await expect(loadWalkedFiles(async () => [{ path: '/a' }], null)).resolves.toEqual([]);
    const clear = vi.fn();
    onThreadPanelTerminalUnmount({ sessionId: 's1' }, 's1', clear);
    expect(clear).toHaveBeenCalled();
    clear.mockClear();
    onThreadPanelTerminalUnmount({ sessionId: 's2' }, 's1', clear);
    expect(clear).not.toHaveBeenCalled();
    await expect(hydrateThreadInfo(null, 't1', null, {
      listEnvironments: async () => [{ id: 'e1', name: 'Dev' }],
      status: async () => ({ dirty: true }),
      pullRequest: async () => ({ pullRequest: { number: 1 } })
    })).resolves.toEqual({
      environmentName: null,
      status: null,
      pullRequest: null
    });
    await expect(hydrateThreadInfo('p', 't1', 'e1', {
      listEnvironments: async () => [{ id: 'e1', name: 'Dev' }],
      status: async () => ({ dirty: true }),
      pullRequest: async () => ({ pullRequest: { number: 1 } })
    })).resolves.toEqual({
      environmentName: 'Dev',
      status: { dirty: true },
      pullRequest: { number: 1 }
    });
  });
});
