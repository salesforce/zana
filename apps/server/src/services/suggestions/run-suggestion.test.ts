import { describe, it, expect, vi } from 'vitest';
import { runSuggestion, type RunSuggestionDeps } from './run-suggestion.js';
import { createMemorySuggestionsStore } from '@zana-ai/zcc-server';
import type { CreateTerminalRequest, Result, TerminalSession } from '@zana-ai/zcc-domain/product';

function makeDeps(overrides: Partial<RunSuggestionDeps> = {}) {
  const store = overrides.store ?? createMemorySuggestionsStore();
  const created: CreateTerminalRequest[] = [];
  const createTerminal = vi.fn((req: CreateTerminalRequest): Result<TerminalSession> => {
    created.push(req);
    return { ok: true, value: { id: 'sess-1' } as unknown as TerminalSession };
  });
  const deps: RunSuggestionDeps = {
    store,
    createTerminal,
    listProjectIds: () => ['p1'],
    ...overrides
  };
  return { deps, store, created, createTerminal };
}

describe('runSuggestion', () => {
  it('returns { ok: false } for an unknown id', async () => {
    const { deps } = makeDeps();
    expect(await runSuggestion('nope', deps)).toEqual({ ok: false });
  });

  it('spawns a terminal for start-terminal and deletes the one-shot', async () => {
    const { deps, store, created } = makeDeps();
    const s = await store.append({
      projectId: 'p1',
      title: 'Run tests',
      reason: 'the branch you pushed is green',
      action: { kind: 'start-terminal', profile: 'shell', cwd: '/some/where' }
    });

    const res = await runSuggestion(s.id, deps);
    expect(res.ok).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ projectId: 'p1', profile: 'shell', cwd: '/some/where' });
    // one-shot removed
    expect((await store.read()).entries).toHaveLength(0);
  });

  it('falls back to the default profile when the suggested profile is unknown', async () => {
    const { deps, store, created } = makeDeps();
    const s = await store.append({
      projectId: 'p1',
      title: 'x',
      reason: 'because',
      action: { kind: 'start-terminal', profile: 'evil-profile' }
    });
    await runSuggestion(s.id, deps);
    expect(created[0].profile).toBe('claude');
  });

  it('propagates an async authorization failure and retains the suggestion', async () => {
    const createTerminal = vi.fn(async (): Promise<Result<TerminalSession>> => ({
      ok: false,
      code: 'DENIED',
      message: 'Structured execution unavailable: approval denied'
    }));
    const { deps, store } = makeDeps({ createTerminal });
    const s = await store.append({
      projectId: 'p1',
      title: 'Run agent',
      reason: 'continue work',
      action: { kind: 'start-agent', prompt: 'Continue' }
    });

    await expect(runSuggestion(s.id, deps)).rejects.toThrow(
      'Structured execution unavailable: approval denied'
    );
    expect(createTerminal).toHaveBeenCalledOnce();
    expect((await store.read()).entries.map((entry) => entry.id)).toEqual([s.id]);
  });

  it('propagates a rejected async spawn and retains the suggestion', async () => {
    const createTerminal = vi.fn(async (): Promise<Result<TerminalSession>> => {
      throw new Error('pty spawn failed');
    });
    const { deps, store } = makeDeps({ createTerminal });
    const s = await store.append({
      projectId: 'p1',
      title: 'Open shell',
      reason: 'inspect output',
      action: { kind: 'start-terminal', profile: 'shell' }
    });

    await expect(runSuggestion(s.id, deps)).rejects.toThrow('pty spawn failed');
    expect((await store.read()).entries.map((entry) => entry.id)).toEqual([s.id]);
  });

  it('runs a combo in order and returns the trailing nav directive, one-shot', async () => {
    const { deps, store, created } = makeDeps();
    const s = await store.append({
      projectId: 'p1',
      title: 'combo',
      reason: 'spawn then jump',
      action: {
        kind: 'combo',
        steps: [
          { kind: 'start-terminal', profile: 'shell' },
          { kind: 'navigate', projectId: 'p1', tabId: 't1' }
        ]
      }
    });
    const res = await runSuggestion(s.id, deps);
    expect(created).toHaveLength(1);
    expect(res).toEqual({ ok: true, projectId: 'p1', tabId: 't1' });
    // combo is one-shot
    expect((await store.read()).entries).toHaveLength(0);
  });

  it('re-authorizes a combo navigate step (forged projectId → no nav directive)', async () => {
    const { deps, store, created } = makeDeps();
    const s = await store.append({
      projectId: 'p1',
      title: 'combo bad nav',
      reason: 'spawn then jump to a forged project',
      action: {
        kind: 'combo',
        steps: [
          { kind: 'start-terminal', profile: 'shell' },
          { kind: 'navigate', projectId: 'not-a-project' }
        ]
      }
    });
    const res = await runSuggestion(s.id, deps);
    expect(created).toHaveLength(1);
    // forged nav yields no directive; the terminal step still ran
    expect(res).toEqual({ ok: true });
  });
});
