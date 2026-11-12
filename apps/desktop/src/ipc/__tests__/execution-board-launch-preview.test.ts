import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<any>>(),
  shared: new Map<string, (...args: any[]) => Promise<any>>(),
  windows: new Map<number, { projectId?: string }>(), preview: vi.fn(), logMainError: vi.fn()
}));
vi.mock('electron', () => ({ dialog: {} }));
vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({ store: { listProjects: () => [{ id: 'p' }] } }));
vi.mock('../shared-product-registry.js', () => ({ registerSharedProduct: (channel: string, handler: any) => h.shared.set(channel, handler) }));
vi.mock('../ctx.js', () => ({ ctx: {
  safeHandle: () => {}, safeHandleFromWindow: (channel: string, handler: any) => h.handlers.set(channel, handler),
  get windows() { return h.windows; }, resolveSquadComposerPreview: (...args: unknown[]) => h.preview(...args),
  logMainError: h.logMainError
} }));
const { registerExecutionBoardIpc } = await import('../execution-board.js');
const request = { teamId: 't', projectId: 'p', goal: 'ship', coordinationMode: 'structured', sourceCapabilityIds: ['cap'], push: false };

describe('teams:preview', () => {
  beforeEach(() => { h.handlers.clear(); h.shared.clear(); h.windows.clear(); h.preview.mockReset(); h.logMainError.mockReset(); registerExecutionBoardIpc(); });
  it('registers real preview and binds capabilities to calling window', async () => {
    expect(h.handlers.has('teams:preview')).toBe(true);
    h.preview.mockResolvedValue({ resolvedLaunch: {}, previewToken: 'main-opaque' });
    expect(await h.handlers.get('teams:preview')!({ id: 7 }, request)).toEqual({ ok: true, value: { resolvedLaunch: {}, previewToken: 'main-opaque' } });
    expect(h.preview).toHaveBeenCalledWith(request, { kind: 'window', windowId: 7 });
  });
  it('rejects foreign projects and renderer-authored paths/metadata', async () => {
    expect(h.handlers.has('teams:preview')).toBe(true);
    h.windows.set(7, { projectId: 'other' });
    expect(await h.handlers.get('teams:preview')!({ id: 7 }, request)).toMatchObject({ ok: false });
    h.windows.clear();
    for (const extra of [{ sourcePaths: ['/tmp'] }, { attachments: [] }, { launchPreview: {} }, { location: {} }, { resolvedLaunch: {} }]) {
      expect(await h.handlers.get('teams:preview')!({ id: 7 }, { ...request, ...extra })).toMatchObject({ ok: false, code: 'INVALID' });
    }
    expect(h.preview).not.toHaveBeenCalled();
  });
  it('logs preview failures with safe identifiers and returns a sanitized response', async () => {
    expect(h.handlers.has('teams:preview')).toBe(true);
    const error = new Error('FOREIGN_CAPABILITY: /private/source/token/command');
    h.preview.mockRejectedValue(error);
    const result = await h.handlers.get('teams:preview')!({ id: 7 }, request);
    expect(result).toEqual({ ok: false, code: 'UNAVAILABLE', message: 'Launch preview could not validate the plan, sources, or target. Retry after correcting them.' });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(h.logMainError).toHaveBeenCalledWith('teams preview (teamId=t, projectId=p)', error);

    // Shared callers retain their capability-free identity on failure too.
    await h.shared.get('teams:preview')!(request);
    expect(h.preview).toHaveBeenLastCalledWith(request, { kind: 'shared-owner' });
  });
});
