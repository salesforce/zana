import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import type { IpcCtx } from './ctx.js';
import { bindIpcCtx } from './ctx.js';
import { registerInboxIpc } from './inbox.js';

vi.mock('electron', () => ({ ipcMain: {} }));
vi.mock('../native/inbox-pdf.js', () => ({ exportInboxPdf: vi.fn() }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { getConfig: vi.fn() } }));

describe('inbox host action IPC', () => {
  type Handler = (window: BrowserWindow, ...args: unknown[]) => unknown;
  type Fallback = () => unknown;
  type DirectHandler = (...args: unknown[]) => unknown;
  const window = { id: 1 } as BrowserWindow;
  let handlers: Map<string, Handler>;
  let fallbacks: Map<string, Fallback>;
  let directHandlers: Map<string, DirectHandler>;
  let directFallbacks: Map<string, Fallback>;
  let scopedProjectId: string | undefined;
  const entry = { id: 'entry-1', projectId: 'project-1', ts: 1, question: { options: [{ id: 'delete', label: 'Delete' }] } };
  const getEntry = vi.fn();
  const list = vi.fn();
  const run = vi.fn(async () => ({ ok: true, status: 'done' as const }));
  const bound = vi.fn();
  const readArtifact = vi.fn();
  const remove = vi.fn();
  const onRemoved = vi.fn();
  const onPruned = vi.fn();

  beforeEach(() => {
    handlers = new Map();
    fallbacks = new Map();
    directHandlers = new Map();
    directFallbacks = new Map();
    scopedProjectId = 'project-2';
    run.mockClear();
    bound.mockReset();
    readArtifact.mockReset(); remove.mockReset(); onRemoved.mockReset(); onPruned.mockReset();
    getEntry.mockReset().mockImplementation(async (id: string) => id === entry.id ? entry : null);
    list.mockReset().mockImplementation((entries) => entries);
    const safeHandleFromWindow: IpcCtx['safeHandleFromWindow'] = ((channel: string, handler: Handler, fallback: Fallback) => {
      handlers.set(channel, handler);
      fallbacks.set(channel, fallback);
    }) as IpcCtx['safeHandleFromWindow'];
    const safeHandle: IpcCtx['safeHandle'] = ((channel: string, handler: DirectHandler, fallback: Fallback) => {
      directHandlers.set(channel, handler);
      directFallbacks.set(channel, fallback);
    }) as IpcCtx['safeHandle'];
    bindIpcCtx({
      safeHandle,
      safeHandleFromWindow,
      windows: { get: () => ({ projectId: scopedProjectId }) },
      inboxStore: { read: async () => ({ entries: [entry] }), get: getEntry, onAppended: vi.fn(), onRemoved, onUpdated: vi.fn(), onPruned },
      inboxActionRegistry: { list, run, bound, remove },
      planCorrection: { readArtifact },
      inboxReadStore: {},
      inboxSummary: {},
      feedNoiseClassifier: {},
      usageService: {},
      memoCounters: () => ({ 'inbox-summary': { requests: 2, hits: 1 } }),
      suggestionsStore: { onAppended: vi.fn(), onRemoved: vi.fn(), onUpdated: vi.fn(), onPruned: vi.fn() },
      handleLoudInboxEntry: vi.fn(),
      safeSend: vi.fn()
    } as unknown as IpcCtx);
    registerInboxIpc();
  });

  it('reads plan decision details only through durable host action binding', async () => {
    scopedProjectId = 'project-1';
    bound.mockReturnValue({ kind: 'plan-correction', ref: 'private-ref' });
    readArtifact.mockResolvedValue('worktree artifact');
    const read = handlers.get(IPC.inbox.hostActions.readDecisionArtifact)!;

    await expect(read(window, 'entry-1', '.zana/execution-plan-corrected-e-1.md')).resolves.toEqual({ ok: true, value: { content: 'worktree artifact' } });
    expect(readArtifact).toHaveBeenCalledWith('private-ref', '.zana/execution-plan-corrected-e-1.md');
  });

  it('serves memo counters over the usage IPC with an empty error fallback', () => {
    expect(directHandlers.get(IPC.usage.getMemoCounters)!()).toEqual({
      'inbox-summary': { requests: 2, hits: 1 }
    });
    expect(directFallbacks.get(IPC.usage.getMemoCounters)!()).toEqual({});
  });

  it('uses a window-aware handler and rejects entries outside sender project scope', async () => {
    const list = handlers.get(IPC.inbox.hostActions.list)!;
    const get = handlers.get(IPC.inbox.hostActions.get)!;
    const action = handlers.get(IPC.inbox.hostActions.run)!;
    expect(await list(window)).toEqual([]);
    expect(await get(window, 'entry-1')).toEqual({ resolved: true, action: null });
    expect(await action(window, 'entry-1', 'delete')).toEqual({ ok: false, status: 'missing' });
    expect(run).not.toHaveBeenCalled();
  });

  it('allows sender project action and forwards only the submitted option id', async () => {
    scopedProjectId = 'project-1';
    const action = handlers.get(IPC.inbox.hostActions.run)!;
    await action(window, 'entry-1', { optionId: 'delete' });
    expect(run).toHaveBeenCalledWith(entry, { optionId: 'delete' });
  });

  it('resolves and runs an old scoped host entry without history pagination', async () => {
    scopedProjectId = 'project-1';
    const get = handlers.get(IPC.inbox.hostActions.get)!;
    const action = handlers.get(IPC.inbox.hostActions.run)!;
    expect(await get(window, 'entry-1')).toEqual({ resolved: true, action: entry });
    await action(window, 'entry-1', { optionId: 'delete' });
    expect(run).toHaveBeenCalledWith(entry, { optionId: 'delete' });
  });

  it('reports lookup failure as unresolved instead of confirmed non-host', async () => {
    const lookupFallback = fallbacks.get(IPC.inbox.hostActions.get)!;
    expect(lookupFallback()).toEqual({ resolved: false, action: null });
  });

  it.each([
    ['handler missing'],
    ['execution database disabled'],
    ['entry content hash changed']
  ])('keeps marked entry unavailable when registry action is absent: %s', async () => {
    scopedProjectId = 'project-1';
    const markedEntry = { ...entry, hostActionRequired: true as const };
    getEntry.mockResolvedValue(markedEntry);
    list.mockReturnValue([]);
    const get = handlers.get(IPC.inbox.hostActions.get)!;

    await expect(get(window, markedEntry.id)).resolves.toEqual({
      resolved: true,
      action: {
        entryId: markedEntry.id,
        kind: 'unavailable',
        status: 'failed',
        unavailable: true,
        message: 'This host action is unavailable. Ordinary reply delivery is disabled.'
      }
    });
  });

  it('lists only entries in the sender project scope and falls back to empty', async () => {
    scopedProjectId = 'project-1';
    const listHandler = handlers.get(IPC.inbox.hostActions.list)!;
    await expect(listHandler(window)).resolves.toEqual([entry]);
    expect(fallbacks.get(IPC.inbox.hostActions.list)!()).toEqual([]);
  });

  it('get rejects invalid ids and returns null action for unknown entries or non-host entries', async () => {
    scopedProjectId = 'project-1';
    const get = handlers.get(IPC.inbox.hostActions.get)!;
    await expect(get(window, '')).resolves.toEqual({ resolved: true, action: null });
    await expect(get(window, 5)).resolves.toEqual({ resolved: true, action: null });
    await expect(get(window, 'missing')).resolves.toEqual({ resolved: true, action: null });
    list.mockReturnValue([]);
    await expect(get(window, 'entry-1')).resolves.toEqual({ resolved: true, action: null });
  });

  it('run rejects malformed input before touching the store', async () => {
    scopedProjectId = 'project-1';
    const action = handlers.get(IPC.inbox.hostActions.run)!;
    for (const args of [[5, { optionId: 'a' }], ['', { optionId: 'a' }], ['entry-1'], ['entry-1', { optionId: 3 }], ['entry-1', { optionId: 'a', text: 4 }]]) {
      await expect(action(window, ...args)).resolves.toEqual({ ok: false, status: 'missing' });
    }
    await expect(action(window, 'unknown', { optionId: 'a' })).resolves.toEqual({ ok: false, status: 'missing' });
    expect(run).not.toHaveBeenCalled();
    await action(window, 'entry-1', { optionId: 'a', text: 'why' });
    expect(run).toHaveBeenCalledWith(entry, { optionId: 'a', text: 'why' });
    expect(fallbacks.get(IPC.inbox.hostActions.run)!()).toEqual({ ok: false, status: 'missing' });
  });

  it('decision artifact read denies invalid, out-of-scope, unbound and non-plan-correction entries', async () => {
    const read = handlers.get(IPC.inbox.hostActions.readDecisionArtifact)!;
    const notFound = { ok: false, code: 'NOT_FOUND', message: 'Decision details unavailable' };
    await expect(read(window, 5, 'p')).resolves.toMatchObject({ code: 'INVALID' });
    await expect(read(window, 'entry-1', 5)).resolves.toMatchObject({ code: 'INVALID' });
    await expect(read(window, 'entry-1', 'p')).resolves.toEqual(notFound); // cross-project
    scopedProjectId = 'project-1';
    await expect(read(window, 'missing', 'p')).resolves.toEqual(notFound);
    bound.mockReturnValue(undefined);
    await expect(read(window, 'entry-1', 'p')).resolves.toEqual(notFound);
    bound.mockReturnValue({ kind: 'other', ref: 'r' });
    await expect(read(window, 'entry-1', 'p')).resolves.toEqual(notFound);
    bound.mockReturnValue({ kind: 'plan-correction', ref: 'r' });
    readArtifact.mockResolvedValue(undefined);
    await expect(read(window, 'entry-1', 'p')).resolves.toEqual(notFound);
    expect(readArtifact).toHaveBeenCalledTimes(1);
    expect(fallbacks.get(IPC.inbox.hostActions.readDecisionArtifact)!()).toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('removes registry bindings when entries are removed or pruned', () => {
    onRemoved.mock.calls[0]![0]('entry-1');
    expect(remove).toHaveBeenCalledWith(['entry-1']);
    onPruned.mock.calls[0]![0](['a', 'b']);
    expect(remove).toHaveBeenCalledWith(['a', 'b']);
  });
});
