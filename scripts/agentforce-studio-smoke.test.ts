import { describe, expect, it, vi } from 'vitest';
import { runAgentforceSmoke, validateSmokeTarget, smokeCli, smokeMain } from './agentforce-studio-smoke.mjs';
const context = { projectId: 'p', selectedAlias: 'dev', orgs: [{ alias: 'dev', kind: 'sandbox' }] };
const options = { expectedOrg: 'dev', expectedProject: 'p', agentPath: 'Bot.agent' };
function fixture() {
  const turns: Array<{ role: string; text: string; latencyMs?: number; planId?: string }> = [];
  const action = vi.fn(async (name: string, args: any): Promise<any> => {
    if (name === 'context.status') return context;
    if (name === 'files.read') return { ok: true, file: { content: 'source' } };
    if (name === 'studio.start') return { ok: true, data: { id: 'r', orgAlias: 'dev' } };
    if (name === 'studio.send') { turns.push({ role: 'user', text: args.text }, { role: 'agent', text: 'help', latencyMs: 100, planId: 'plan' }); return { ok: true, data: { turns: [...turns] } }; }
    if (name === 'preview.trace') return { ok: true, data: { available: true, steps: [{}] } };
    if (name === 'studio.end') return { ok: true };
    throw Error(name);
  });
  const agent = vi.fn(async () => ({ ok: true, data: { diagnostics: [] } }));
  return { action, agent };
}
describe('sandbox smoke runner', () => {
  it('uses bounded structured CLI calls and sanitizes transport errors containing source', async () => {
    const command = vi.fn(async () => ({ stdout: '{"ok":true}' }));
    expect(await smokeCli('action', 'files.read', { path: 'Bot.agent' }, command)).toEqual({ ok: true });
    expect(command).toHaveBeenCalledWith('zcc', ['sf', 'action', 'files.read', '--input', '{"path":"Bot.agent"}', '--json'], { timeout: 120000, maxBuffer: 4194304 });
    await expect(smokeCli('tool', 'sf_agent', {}, async () => { throw Object.assign(Error('SECRET SOURCE in argv'), { stdout: '{"error":"Offline"}' }); })).rejects.toThrow('Offline');
    await expect(smokeCli('tool', 'sf_agent', {}, async () => { throw Error('SECRET SOURCE in argv'); })).rejects.toThrow('sf_agent failed or timed out; no successful smoke result was recorded.');
  });
  it('reports CLI success only with evidence and nonzero failures without an agent', async () => {
    const f = fixture(); const stdout = { write: vi.fn() }; const stderr = { write: vi.fn() };
    const cli = vi.fn(async (kind: string, name: string, input: any) => kind === 'tool' ? f.agent() : f.action(name, input));
    expect(await smokeMain(['--org', 'dev', '--project', 'p', '--agent', 'Bot.agent'], cli, stdout, stderr)).toBe(0);
    expect(JSON.parse(stdout.write.mock.calls[0]![0])).toMatchObject({ ok: true, turns: 2 });
    expect(stderr.write).not.toHaveBeenCalled();
    expect(await smokeMain([], cli, stdout, stderr)).toBe(1);
    expect(stderr.write).toHaveBeenCalledWith(expect.stringContaining('Pass --agent'));
  });
  it('refuses missing, changed and non-sandbox targets', () => {
    for (const [ctx, org, project] of [[context, '', 'p'], [context, 'dev', ''], [{ ...context, projectId: 'other' }, 'dev', 'p'], [{ ...context, selectedAlias: 'other' }, 'dev', 'p'], [{ ...context, orgs: [{ alias: 'dev', kind: 'production' }] }, 'dev', 'p'], [{ ...context, orgs: [] }, 'dev', 'p']] as const) expect(() => validateSmokeTarget(ctx, org, project)).toThrow();
  });
  it('checks real conversation and trace evidence, then closes the session', async () => {
    const f = fixture();
    expect(await runAgentforceSmoke({ ...options, ...f })).toMatchObject({ ok: true, turns: 2, traceSteps: 1, latencyMs: [100, 100] });
    expect(f.action.mock.calls.at(-1)).toEqual(['studio.end', { id: 'r' }]);
    expect(f.agent.mock.calls).toHaveLength(2);
    expect(f.action.mock.calls.find(([n]) => n === 'studio.start')?.[1]).toMatchObject({ engine: 'preview' });
  });
  it.each(['studio.send', 'preview.trace'])('closes its session after %s fails', async method => {
    const f = fixture(); const call = f.action.getMockImplementation()!;
    f.action.mockImplementation(async (name, args) => name === method ? { ok: false, error: 'offline' } : call(name, args));
    await expect(runAgentforceSmoke({ ...options, ...f })).rejects.toThrow('offline');
    expect(f.action.mock.calls.at(-1)).toEqual(['studio.end', { id: 'r' }]);
  });
  it('never starts a session after diagnostics fail or the target changes', async () => {
    const f = fixture();
    f.agent.mockResolvedValue({ ok: false, error: 'compile problem' } as never);
    await expect(runAgentforceSmoke({ ...options, ...f })).rejects.toThrow('compile problem');
    expect(f.action.mock.calls.some(([n]) => n === 'studio.start')).toBe(false);
    const g = fixture(); let checks = 0; const call = g.action.getMockImplementation()!;
    g.action.mockImplementation(async (name, args) => name === 'context.status' && ++checks > 1 ? { ...context, selectedAlias: 'other' } : call(name, args));
    await expect(runAgentforceSmoke({ ...options, ...g })).rejects.toThrow(/selected org changed/);
    expect(g.action.mock.calls.some(([n]) => n === 'studio.start')).toBe(false);
  });
});
