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
