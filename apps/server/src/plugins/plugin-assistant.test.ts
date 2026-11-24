import { beforeEach, expect, it, vi } from 'vitest';
const run = vi.hoisted(() => vi.fn());
vi.mock('@zana-ai/zcc-llm', () => ({
  ClaudeCliProvider: class {
    run = run;
  }
}));
import { completePluginAssistant, listDesktopAssistantModels } from './plugin-assistant.js';
const ctx = () =>
  ({
    config: {
      getConfig: () => ({ harnesses: { byId: { claude: { binary: '/configured/claude' } } } })
    }
  }) as any;
const input = { instructions: 'Return a decision', prompt: 'Which Project?' };
beforeEach(() => {
  run.mockReset().mockResolvedValue({ ok: true, text: 'answer' });
});
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

const desktop = vi.hoisted(() => ({
  host: vi.fn(),
  provider: vi.fn(),
  readiness: vi.fn(),
  catalog: vi.fn()
}));
vi.mock('@zana-ai/zcc-db', () => ({ getHost: desktop.host }));
vi.mock('../http/provider-readiness-api.js', () => ({ getProviderReadiness: desktop.readiness }));
vi.mock('../services/threads/thread-provider-catalog.js', () => ({
  getThreadProvider: desktop.provider,
  bridgeLaunchForProvider: () => ({ providerId: 'claude-code' })
}));

const model = (id: string, isDefault = false) => ({
  id, model: id, displayName: id, isDefault, supportedReasoningEfforts: []
});
const models = [model('first', true), model('second')];
const provider = { id: 'claude-code', displayName: 'Claude Code', models: { scope: 'host' } };
const first = { providerId: 'claude-code', providerLabel: 'Claude Code', modelId: 'first', modelLabel: 'first' };
const second = { providerId: 'claude-code', modelId: 'second' };

function desktopContext() {
  const config = { defaultThreadProviderId: 'claude-code' };
  return {
    ctx: {
      desktopHostId: () => 'this-mac',
      config: { getConfig: () => config },
      modelCatalogs: { read: desktop.catalog }
    } as unknown as import('../http/product-context.js').ProductHttpContext,
    config
  };
}

beforeEach(() => {
  desktop.host.mockReset().mockReturnValue({ enrollmentCapability: 'execution', homeDir: '/this-mac' });
  desktop.provider.mockReset().mockReturnValue(provider);
  desktop.readiness.mockReset().mockResolvedValue({ providerId: 'claude-code', hostId: 'this-mac',
    result: { supported: true, health: { status: 'ready' } } });
  desktop.catalog.mockReset().mockResolvedValue({ models, selectedOnlyModels: [], modelLoadError: null });
});

it('validates readiness and model inventory on the attested desktop even with another host enrolled', async () => {
  const { ctx } = desktopContext();
  expect(await listDesktopAssistantModels(ctx)).toMatchObject({ defaultModel: first, models: [first, second] });
  expect(desktop.readiness).toHaveBeenCalledWith(ctx, 'claude-code', 'this-mac');
  expect(desktop.catalog).toHaveBeenCalledWith(expect.objectContaining({ hostId: 'this-mac', cwd: '/this-mac' }));
  await completePluginAssistant(ctx, { ...input, desktop: { model: second } });
  expect(desktop.catalog).toHaveBeenLastCalledWith(expect.objectContaining({ requiredModel: 'second' }));
  expect(run).toHaveBeenCalledWith(expect.objectContaining({ model: 'second', isolated: true, disableTools: true }));
});

it('re-resolves the shared default and never silently substitutes for an explicit model', async () => {
  const { ctx, config } = desktopContext();
  await completePluginAssistant(ctx, { ...input, desktop: {} });
  expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'first' }));
  desktop.catalog.mockResolvedValue({ models: [model('second', true)], selectedOnlyModels: [], modelLoadError: null });
  await completePluginAssistant(ctx, { ...input, desktop: {} });
  expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'second' }));
  await expect(completePluginAssistant(ctx, { ...input, desktop: { model: { providerId: 'claude-code', modelId: 'first' } } })).rejects.toThrow('unavailable');
  config.defaultThreadProviderId = 'codex';
  await expect(completePluginAssistant(ctx, { ...input, desktop: {} })).rejects.toThrow('unavailable');
  expect(run).toHaveBeenCalledTimes(2);
});

it('applies the remembered model only within the current default provider and inventory', async () => {
  const { ctx, config } = desktopContext();
  await completePluginAssistant(ctx, { ...input, desktop: { preferredDefault: second } });
  expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'second' }));
  await completePluginAssistant(ctx, { ...input, desktop: {
    preferredDefault: { ...second, modelId: 'removed' }
  } });
  expect(run).toHaveBeenLastCalledWith(expect.objectContaining({ model: 'first' }));
  config.defaultThreadProviderId = 'codex';
  await expect(completePluginAssistant(ctx, { ...input, desktop: { preferredDefault: second } }))
    .rejects.toThrow('unavailable');
  expect(run).toHaveBeenCalledTimes(2);
});

it('stays offline without local identity, with only remote credentials, or if discovery fails', async () => {
  const { ctx } = desktopContext();
  const unavailable = { defaultModel: null, models: [] };
  const missingHost = { ...ctx, desktopHostId: undefined };
  expect(await listDesktopAssistantModels(missingHost)).toEqual(unavailable);
  expect(desktop.readiness).not.toHaveBeenCalled();
  desktop.readiness.mockResolvedValueOnce({ providerId: 'claude-code', hostId: 'remote',
    result: { supported: true, health: { status: 'ready' } } });
  expect(await listDesktopAssistantModels(ctx)).toEqual(unavailable);
  desktop.readiness.mockResolvedValueOnce({ providerId: 'claude-code', hostId: 'this-mac',
    result: { supported: true, health: { status: 'unauthenticated' } } });
  expect(await listDesktopAssistantModels(ctx)).toEqual(unavailable);
  expect(desktop.catalog).not.toHaveBeenCalled();
  desktop.catalog.mockRejectedValueOnce(new Error('unreachable'));
  expect(await listDesktopAssistantModels(ctx)).toEqual(unavailable);
});
