import { describe, it, expect, vi } from 'vitest';
import { LlmService, fillTemplate } from './llm-service.js';
import type { LlmProvider, LlmRunRequest } from './provider.js';
import type { LlmPromptEntry, LlmRunResult } from '@zana-ai/zcc-domain/llm';

const entry = (over: Partial<LlmPromptEntry> = {}): LlmPromptEntry => ({
  id: 'test',
  label: 'Test',
  systemPrompt: 'sys',
  userTemplate: 'Hello {{name}}',
  provider: 'claude-cli',
  ...over
});

/** A fake provider that records the request and returns a canned result. */
function fakeProvider(
  result: Partial<LlmRunResult> = {},
  capture?: (req: LlmRunRequest) => void
): LlmProvider {
  return {
    id: 'claude-cli',
    run: vi.fn(async (req: LlmRunRequest) => {
      capture?.(req);
      return {
        ok: true,
        text: 'ok',
        provider: 'claude-cli' as const,
        ms: 1,
        ...result
      };
    })
  };
}

describe('fillTemplate', () => {
  it('fills known placeholders and tolerates whitespace', () => {
    expect(fillTemplate('Hi {{name}} / {{ name }}', { name: 'Ada' })).toBe('Hi Ada / Ada');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(fillTemplate('Hi {{missing}}', { name: 'Ada' })).toBe('Hi {{missing}}');
  });
});

describe('LlmService.run', () => {
  it('fills the template and forwards entry config to the provider', async () => {
    let seen: LlmRunRequest | null = null;
    const provider = fakeProvider({ text: 'World' }, (r) => (seen = r));
    const svc = new LlmService(new Map([['claude-cli', provider]]));

    const r = await svc.run(entry({ model: 'haiku', maxOutputChars: 10, timeoutMs: 5_000 }), {
      name: 'World'
    });

    expect(r.ok).toBe(true);
    expect(r.text).toBe('World');
    expect(seen).toMatchObject({
      system: 'sys',
      user: 'Hello World',
      model: 'haiku',
      maxOutputChars: 10,
      timeoutMs: 5_000
    });
  });

  it('returns an ok:false result when the provider is missing', async () => {
    const svc = new LlmService(new Map());
    const r = await svc.run(entry({ provider: 'openai' }), {});
    expect(r.ok).toBe(false);
    expect(r.error).toContain('openai');
  });

  it('de-dupes concurrent calls sharing a dedupeKey', async () => {
    const provider = fakeProvider();
    const svc = new LlmService(new Map([['claude-cli', provider]]));

    const [a, b] = await Promise.all([
      svc.run(entry(), { name: 'x' }, 'sess-1'),
      svc.run(entry(), { name: 'x' }, 'sess-1')
    ]);

    expect(a).toBe(b); // same promise result
    expect(provider.run).toHaveBeenCalledTimes(1);
  });

  it('runs separately for different dedupe keys', async () => {
    const provider = fakeProvider();
    const svc = new LlmService(new Map([['claude-cli', provider]]));
    await Promise.all([
      svc.run(entry(), {}, 'sess-1'),
      svc.run(entry(), {}, 'sess-2')
    ]);
    expect(provider.run).toHaveBeenCalledTimes(2);
  });
});

describe('LlmService.availableProviders', () => {
  const withConfigured = (id: LlmProvider['id'], configured: boolean): LlmProvider => ({
    id,
    run: vi.fn(async () => ({ ok: true, text: '', provider: id, ms: 0 })),
    isConfigured: () => configured
  });

  it('includes a provider that omits isConfigured (always-configured, like claude-cli)', () => {
    const svc = new LlmService(new Map([['claude-cli', fakeProvider()]]));
    expect(svc.availableProviders()).toEqual(['claude-cli']);
  });

  it('includes a key-gated provider only when isConfigured() is true', () => {
    const svc = new LlmService(
      new Map<LlmProvider['id'], LlmProvider>([
        ['claude-cli', fakeProvider()],
        ['openai', withConfigured('openai', true)],
        ['gemini', withConfigured('gemini', false)]
      ])
    );
    const ids = svc.availableProviders();
    expect(ids).toContain('claude-cli');
    expect(ids).toContain('openai');
    expect(ids).not.toContain('gemini');
  });
});
