import { describe, expect, it, vi } from 'vitest';
import type { CcApi } from '@zana-ai/zcc-desktop-contract';
import { buildHostRepairPrompt, hostRepairCommand, startHostRepairAgent } from './host-repair-agent.js';

const state = { target: 'educational-roadrunner', error: 'Enrollment belongs to another server', logs: ['SSH connected', '--join-code zcde_secret'], stages: [] };
function fixture() {
  const provider = (id: string, available = true, modes = ['accept-edits']) => ({ id, available, capabilities: { permissionModes: modes } });
  const api = {
    hosts: { list: vi.fn(async () => [{ id: 'remote', isPrimary: false, status: 'disconnected' }, { id: 'local', isPrimary: true, status: 'connected' }]) },
    projects: { ensureQuickAgent: vi.fn(async () => ({ ok: true, value: { id: 'default', hostId: 'local' } })) },
    threads: {
      executionOptions: vi.fn(async (_input: unknown) => ({ providers: [provider('claude-code'), provider('codex')] })),
      create: vi.fn(async (_input: unknown) => ({ ok: true, value: { id: 'repair', projectId: 'default', hostId: 'local' } }))
    }
  };
  const start = (harness?: 'codex') => startHostRepairAgent(api as unknown as CcApi, state, { hostId: 'remote' }, harness);
  return { api, start, provider };
}

describe('local host repair agent', () => {
  it('uses local execution options and a normal local thread even for a disconnected remote', async () => {
    const { api, start } = fixture();
    expect(await start('codex')).toMatchObject({ id: 'repair', hostId: 'local' });
    expect(api.threads.executionOptions).toHaveBeenCalledWith({ hostId: 'local', projectId: 'default' });
    expect(api.threads.create).toHaveBeenCalledWith(expect.objectContaining({ hostId: 'local', projectId: 'default', providerId: 'codex', environment: { kind: 'unmanaged' }, permissionMode: 'accept-edits' }));
    const prompt = (api.threads.create.mock.calls[0] as unknown as [{ input: string }])[0].input;
    expect(prompt).toContain('zcc machine repair');
    expect(prompt).toContain('Enrollment belongs to another server');
    expect(prompt).toContain('machine show');
    expect(prompt).not.toContain('zcde_secret');
  });
  it('falls back to an available provider without imposing an unsupported permission mode', async () => {
    const f = fixture();
    f.api.threads.executionOptions.mockResolvedValue({ providers: [f.provider('codex', false), f.provider('other', true, [])] });
    await f.start('codex');
    expect(f.api.threads.create).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'other' }));
    expect((f.api.threads.create.mock.calls[0] as unknown as [object])[0]).not.toHaveProperty('permissionMode');
  });
  it('reports missing local host, project, provider and create failures without launching remotely', async () => {
    const f = fixture();
    f.api.hosts.list.mockResolvedValue([]);
    await expect(f.start()).rejects.toThrow('this computer');
    expect(f.api.projects.ensureQuickAgent).not.toHaveBeenCalled();
    const p = fixture();
    p.api.projects.ensureQuickAgent.mockResolvedValue({ ok: false, message: 'No local folder' } as never);
    await expect(p.start()).rejects.toThrow('No local folder');
    for (const value of [{ id: 'bad', hostId: 'remote' }, { id: 'bad', remote: { host: 'box' } }]) {
      p.api.projects.ensureQuickAgent.mockResolvedValue({ ok: true, value } as never);
      await expect(p.start()).rejects.toThrow('local Default Project');
    }
    expect(p.api.threads.executionOptions).not.toHaveBeenCalled();
    const n = fixture();
    n.api.threads.executionOptions.mockResolvedValue({ providers: [] });
    await expect(n.start()).rejects.toThrow('local agent provider');
    expect(n.api.threads.create).not.toHaveBeenCalled();
    const c = fixture();
    c.api.threads.create.mockResolvedValue({ ok: false, message: 'Host went offline' } as never);
    await expect(c.start()).rejects.toThrow('Host went offline');
  });
  it('quotes every CLI target and bounds redacted diagnostic data', () => {
    expect(hostRepairCommand({ projectId: "a'b" })).toBe("zcc machine connect --project 'a'\\''b' --json");
    expect(hostRepairCommand({ ssh: { host: 'box', user: 'me' } })).toContain("--ssh 'box' --user 'me'");
    expect(hostRepairCommand({ ssh: { host: 'box' } })).not.toContain('--user');
    const prompt = buildHostRepairPrompt({ ...state, target: null, logs: ['x'.repeat(60_000), 'token=secret-value'] }, { projectId: 'p' });
    expect(prompt.length).toBeLessThan(28_000);
    expect(prompt).toContain('[redacted]');
    expect(prompt).not.toContain('secret-value');
    const quoted = buildHostRepairPrompt({ ...state, logs: ['hostKey="quoted-secret"'] }, { hostId: 'h' });
    expect(quoted).not.toContain('quoted-secret');
  });
});
