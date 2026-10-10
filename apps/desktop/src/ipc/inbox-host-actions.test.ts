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
  const window = { id: 1 } as BrowserWindow;
  let handlers: Map<string, Handler>;
  let fallbacks: Map<string, Fallback>;
  let scopedProjectId: string | undefined;
  const entry = { id: 'entry-1', projectId: 'project-1', ts: 1, question: { options: [{ id: 'delete', label: 'Delete' }] } };
  const getEntry = vi.fn();
  const list = vi.fn();
  const run = vi.fn(async () => ({ ok: true, status: 'done' as const }));
  const bound = vi.fn();
  const readArtifact = vi.fn();

  beforeEach(() => {
    handlers = new Map();
    fallbacks = new Map();
    scopedProjectId = 'project-2';
    run.mockClear();
    bound.mockReset();
    readArtifact.mockReset();
    getEntry.mockReset().mockImplementation(async (id: string) => id === entry.id ? entry : null);
    list.mockReset().mockImplementation((entries) => entries);
    const safeHandleFromWindow: IpcCtx['safeHandleFromWindow'] = ((channel: string, handler: Handler, fallback: Fallback) => {
      handlers.set(channel, handler);
      fallbacks.set(channel, fallback);
    }) as IpcCtx['safeHandleFromWindow'];
    bindIpcCtx({
      safeHandle: vi.fn(),
      safeHandleFromWindow,
      windows: { get: () => ({ projectId: scopedProjectId }) },
      inboxStore: { read: async () => ({ entries: [entry] }), get: getEntry, onAppended: vi.fn(), onRemoved: vi.fn(), onUpdated: vi.fn(), onPruned: vi.fn() },
      inboxActionRegistry: { list, run, bound, remove: vi.fn() },
      planCorrection: { readArtifact },
      inboxReadStore: {},
      inboxSummary: {},
      feedNoiseClassifier: {},
      usageService: {},
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
});
