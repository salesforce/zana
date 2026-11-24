import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const { run, binary, primaryHost, effective, route, provider } = vi.hoisted(() => ({
  run: vi.fn(), binary: vi.fn(), primaryHost: vi.fn(), effective: vi.fn(), route: vi.fn(), provider: vi.fn()
}));
vi.mock('@zana-ai/zcc-llm', () => ({
  ClaudeCliProvider: class {
    constructor(path: string) { binary(path); }
    run = run;
  }
}));
vi.mock('@zana-ai/zcc-db', () => ({ getPrimaryHost: primaryHost }));
vi.mock('../http/project-host.js', () => ({ resolveProjectHost: () => 'h1' }));
vi.mock('../http/plugin-harness-routing.js', () => ({
  productProjectHarnessDefault: effective,
  pluginEffectiveHarnessDefault: (_ctx: unknown, _scope: unknown, resolve: () => unknown) => resolve(),
  productPluginSpawnRouting: route
}));
vi.mock('../services/threads/thread-provider-catalog.js', () => ({
  getThreadProvider: provider,
  bridgeLaunchForProvider: () => ({})
}));
import { completePluginAssistant } from './plugin-assistant.js';
const ctx = () =>
  ({
    toProjects: () => [{ id: 'p1', hostId: 'h1' }],
    hostHub: { callHostOnlineRpc: vi.fn().mockResolvedValue({ model: 'codex-default', value: { text: 'Codex answer' } }) },
    modelCatalogs: { read: vi.fn().mockResolvedValue({ models: [{ id: 'first' }, { id: 'codex-default', isDefault: true }] }) },
    config: {
      getConfig: () => ({ harnesses: { byId: { claude: { binary: '/configured/claude' } } } })
    }
  }) as any;
const input = { instructions: 'Return a decision', prompt: 'Which Project?' };
beforeEach(() => {
  run.mockReset().mockResolvedValue({ ok: true, text: 'answer' });
  binary.mockClear();
  primaryHost.mockReset().mockReturnValue({ id: 'h1' });
  effective.mockReset().mockResolvedValue({ ok: true, family: 'codex', profile: 'codex' });
  route.mockReset().mockResolvedValue(null);
  provider.mockReset().mockReturnValue({ displayName: 'Codex' });
  vi.stubEnv('ZCC_CLAUDE_CODE_EXECUTABLE', undefined);
  vi.stubEnv('BB_CLAUDE_CODE_EXECUTABLE', undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });
it('uses text-only inference with hard timeout and output cap', async () => {
  expect(await completePluginAssistant(ctx(), input)).toEqual({ text: 'answer' });
  expect(run).toHaveBeenCalledWith(
    expect.objectContaining({
      disableTools: true,
      model: 'haiku',
      timeoutMs: 30000,
      maxOutputChars: 6000,
      system: input.instructions,
      user: input.prompt
    })
  );
});
it('limits concurrent inference and releases capacity after failures', async () => {
  const context = ctx();
  const resolves: Array<(v: unknown) => void> = [];
  run.mockImplementation(
    () =>
      new Promise((r) => {
        resolves.push(r);
      })
  );
  const one = completePluginAssistant(context, input),
    two = completePluginAssistant(context, input);
  await expect(completePluginAssistant(context, input)).rejects.toThrow(/busy/);
  resolves[0]({ ok: true, text: 'first' });
  resolves[1]({ ok: true, text: 'second' });
  await Promise.all([one, two]);
  run.mockRejectedValueOnce(new Error('error'));
  await expect(completePluginAssistant(context, input)).rejects.toThrow('error');
  run.mockResolvedValueOnce({ ok: true, text: 'third' });
  expect(await completePluginAssistant(context, input)).toEqual({ text: 'third' });
});
it.each([
  { ok: false, text: '' },
  { ok: true, text: ' ' }
])('rejects unavailable or empty output %j', async (result) => {
  run.mockResolvedValue(result);
  await expect(
    completePluginAssistant({ config: { getConfig: () => ({}) } } as any, input)
  ).rejects.toThrow(/unavailable/);
});
it('rejects invalid/oversized input and honors cancellation before and after inference', async () => {
  await expect(
    completePluginAssistant(ctx(), { ...input, prompt: 'a'.repeat(60001) })
  ).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(
    completePluginAssistant(ctx(), { ...input, signal: controller.signal })
  ).rejects.toThrow();
  const later = new AbortController();
  run.mockImplementationOnce(async () => {
    later.abort();
    return { ok: true, text: 'late' };
  });
  await expect(
    completePluginAssistant(ctx(), { ...input, signal: later.signal })
  ).rejects.toThrow();
});

it('routes the project default Codex model to the existing tool-free host command', async () => {
  const context = ctx();
  await expect(completePluginAssistant(context, { ...input, projectId: 'p1' }, 'bots'))
    .resolves.toEqual({ text: 'Codex answer', providerId: 'codex' });
  expect(context.hostHub.callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
    hostId: 'h1',
    command: expect.objectContaining({
      type: 'codex.inference.complete', model: 'codex-default', prompt: expect.stringContaining(input.prompt),
      outputSchema: expect.objectContaining({ required: ['text'] })
    })
  }));
  expect(context.modelCatalogs.read).toHaveBeenCalledTimes(1);
  expect(run).not.toHaveBeenCalled();

  route.mockResolvedValue({ model: 'another-model' });
  await completePluginAssistant(context, { ...input, projectId: 'p1' });
  expect(context.hostHub.callHostOnlineRpc).toHaveBeenLastCalledWith(expect.objectContaining({
    command: expect.objectContaining({ model: 'another-model' })
  }));
  expect(context.modelCatalogs.read).toHaveBeenCalledTimes(1);
});

it('uses the configured Claude executable for an isolated Claude default', async () => {
  effective.mockResolvedValue({ ok: true, family: 'claude', profile: 'claude' });
  route.mockResolvedValue({ model: 'opus' });
  await expect(completePluginAssistant(ctx(), { ...input, projectId: 'p1' })).resolves.toEqual({ text: 'answer', providerId: 'claude-code' });
  expect(binary).toHaveBeenLastCalledWith('/configured/claude');
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ model: 'opus', isolated: true, disableTools: true }));

  vi.stubEnv('ZCC_CLAUDE_CODE_EXECUTABLE', '/runtime/override');
  await completePluginAssistant(ctx(), { ...input, projectId: 'p1' });
  expect(binary).toHaveBeenLastCalledWith('/runtime/override');
});

it('fails closed for other providers, unavailable defaults, and remote Claude', async () => {
  const context = ctx();
  const request = { ...input, projectId: 'p1' };
  effective.mockResolvedValueOnce({ ok: true, family: 'pi', profile: 'pi' });
  provider.mockReturnValueOnce({ displayName: 'Pi' });
  await expect(completePluginAssistant(context, request)).rejects.toThrow(/Pi is unavailable for text-only chat/);

  effective.mockResolvedValueOnce({ ok: false });
  await expect(completePluginAssistant(context, request)).rejects.toThrow(/No usable project AI provider/);

  effective.mockResolvedValueOnce({ ok: true, family: 'claude', profile: 'claude' });
  provider.mockReturnValueOnce({ displayName: 'Claude Code' });
  primaryHost.mockReturnValueOnce({ id: 'not-local' });
  await expect(completePluginAssistant(context, request)).rejects.toThrow(/Claude Code couldn’t answer/);

  await expect(completePluginAssistant(context, { ...input, projectId: 'unregistered' })).rejects.toThrow(/project is unavailable/);
  expect(run).not.toHaveBeenCalled();
  expect(context.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
});

it('sanitizes transport errors and empty output without switching providers', async () => {
  const context = ctx();
  const request = { ...input, projectId: 'p1' };
  context.hostHub.callHostOnlineRpc.mockRejectedValueOnce(new Error('private upstream message'));
  await expect(completePluginAssistant(context, request)).rejects.toThrow(/Codex couldn’t answer/);
  context.hostHub.callHostOnlineRpc.mockResolvedValueOnce({ model: 'default', value: { text: '' } });
  await expect(completePluginAssistant(context, request)).rejects.toThrow(/empty answer/);
  expect(run).not.toHaveBeenCalled();
});

it('does not send an existing conversation to a changed default provider', async () => {
  const context = ctx();
  await expect(completePluginAssistant(context, {
    ...input, projectId: 'p1', expectedProviderId: 'claude-code'
  })).rejects.toThrow(/Start a new conversation/);
  expect(context.hostHub.callHostOnlineRpc).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});
