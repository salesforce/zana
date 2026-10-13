import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { registerSkillsIpc } from './skills.js';

const h = vi.hoisted(() => ({
  registrations: new Map<string, { handler: (...args: unknown[]) => unknown; fallback: () => unknown }>(),
  apply: vi.fn()
}));
vi.mock('electron', () => ({ ipcMain: {} }));
vi.mock('./ctx.js', () => ({ ctx: {
  safeHandle: (channel: string, handler: (...args: unknown[]) => unknown, fallback: () => unknown) =>
    h.registrations.set(channel, { handler, fallback }),
  skillBundles: { on: vi.fn() }
} }));
vi.mock('@zana-ai/zcc-server/services/skills/commands', () => ({ listCommands: vi.fn() }));
vi.mock('@zana-ai/zcc-server/services/skills/skills', () => ({
  listSkills: vi.fn(), readHooks: vi.fn(), revealSkillDir: vi.fn(), setManyEnabled: vi.fn(), setSkillEnabled: vi.fn()
}));
vi.mock('@zana-ai/zcc-server/services/skills/skill-state', () => ({ applySkillStates: h.apply }));
vi.mock('@zana-ai/zcc-server/electron-data-dir', () => ({ electronZccDataDir: () => '/host-owned/data' }));

beforeEach(() => {
  h.registrations.clear();
  h.apply.mockReset();
  registerSkillsIpc();
});

describe('skill state IPC', () => {
  it('uses the host data directory and returns the committed batch result', async () => {
    const updates = [{ id: 'zcc:plugin/review', name: 'review', state: 'manual' }];
    const result = { ok: true, applied: 1, rejected: 0 };
    h.apply.mockResolvedValue(result);
    await expect(h.registrations.get(IPC.skills.setState)!.handler(updates, '/renderer/path')).resolves.toEqual(result);
    expect(h.apply).toHaveBeenCalledWith('/host-owned/data', updates);
  });

  it('provides a failed result with zero acknowledged updates when the handler fails', async () => {
    h.apply.mockRejectedValue(new Error('disk unavailable'));
    const registration = h.registrations.get(IPC.skills.setState)!;
    await expect(registration.handler([])).rejects.toThrow('disk unavailable');
    expect(registration.fallback()).toEqual({ ok: false, applied: 0, rejected: 0 });
  });
});
