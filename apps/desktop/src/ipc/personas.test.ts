import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showSaveDialog: vi.fn(), showOpenDialog: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null }
}));
vi.mock('@zana-ai/zcc-server/services/agents/squad-bundle', () => ({
  buildSquadBundle: vi.fn(),
  validateSquadBundle: vi.fn()
}));

describe('registerPersonasIpc plugin contribution bridge', () => {
  beforeEach(() => vi.resetModules());

  it('forwards a plugin persona/team contribution to the host-stamped registry, rejecting a missing pluginId', async () => {
    const { bindIpcCtx } = await import('./ctx.js');
    const { registerPersonasIpc } = await import('./personas.js');
    const { invokeSharedProduct } = await import('./shared-product-registry.js');

    const setPersonas = vi.fn();
    const setTeams = vi.fn();
    bindIpcCtx({
      personas: { on: vi.fn(), list: vi.fn(() => []) },
      teams: { on: vi.fn(), list: vi.fn(() => []) },
      quickPrompts: { on: vi.fn(), list: vi.fn(() => []) },
      promptRegistry: { on: vi.fn(), list: vi.fn(() => []) },
      personaTeamRegistry: { setPersonas, setTeams },
      safeSend: vi.fn()
    } as any);

    registerPersonasIpc();

    await expect(
      invokeSharedProduct({ method: 'personas.contribute', args: ['pr-monitor', [{ id: 'reviewer', name: 'Reviewer' }]] })
    ).resolves.toEqual({ ok: true, value: true });
    expect(setPersonas).toHaveBeenCalledWith('pr-monitor', [{ id: 'reviewer', name: 'Reviewer' }]);

    await expect(
      invokeSharedProduct({ method: 'teams.contribute', args: ['pr-monitor', [{ id: 'squad', name: 'Squad' }]] })
    ).resolves.toEqual({ ok: true, value: true });
    expect(setTeams).toHaveBeenCalledWith('pr-monitor', [{ id: 'squad', name: 'Squad' }]);

    await expect(
      invokeSharedProduct({ method: 'personas.contribute', args: ['', []] })
    ).resolves.toEqual({ ok: false, code: 'INVALID', message: 'pluginId is required' });
    await expect(
      invokeSharedProduct({ method: 'teams.contribute', args: ['  ', []] })
    ).resolves.toEqual({ ok: false, code: 'INVALID', message: 'pluginId is required' });
    expect(setPersonas).toHaveBeenCalledTimes(1);
    expect(setTeams).toHaveBeenCalledTimes(1);
  });
});

describe('registerPersonasIpc load warnings', () => {
  beforeEach(() => vi.resetModules());

  it('returns store warnings, takes no parameters, and degrades to []', async () => {
    const { bindIpcCtx } = await import('./ctx.js');
    const { registerPersonasIpc } = await import('./personas.js');
    const { ipcMain } = await import('electron');
    const { IPC } = await import('@zana-ai/zcc-desktop-contract');
    const warnings = [{ file: 'bad.json', source: 'user', reason: 'malformed_json' }];
    const loadWarnings = vi.fn(() => warnings);
    bindIpcCtx({
      personas: { on: vi.fn(), list: vi.fn(() => []), loadWarnings },
      teams: { on: vi.fn(), list: vi.fn(() => []) },
      quickPrompts: { on: vi.fn(), list: vi.fn(() => []) },
      promptRegistry: { on: vi.fn(), list: vi.fn(() => []) },
      safeSend: vi.fn()
    } as any);
    registerPersonasIpc();
    expect(IPC.personas.loadWarnings).toBe('personas:load-warnings');

    // Foreign renderer-supplied arguments never reach the store.
    const call = (...args: unknown[]) => {
      const entry = (ipcMain.handle as any).mock.calls.filter((c: unknown[]) => c[0] === IPC.personas.loadWarnings).at(-1);
      return entry[1]({}, ...args);
    };
    await expect(call('../../etc', { projectId: 'x' })).resolves.toEqual(warnings);
    expect(loadWarnings).toHaveBeenCalledTimes(1);
    expect(loadWarnings).toHaveBeenCalledWith();

    loadWarnings.mockImplementationOnce(() => { throw new Error('boom'); });
    await expect(call()).resolves.toEqual([]);
  });
});

