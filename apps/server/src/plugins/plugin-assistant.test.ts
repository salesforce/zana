import { beforeEach, expect, it, vi } from 'vitest';
const run = vi.hoisted(() => vi.fn());
vi.mock('@zana-ai/zcc-llm', () => ({
  ClaudeCliProvider: class {
    run = run;
  }
}));
import { completePluginAssistant } from './plugin-assistant.js';
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
