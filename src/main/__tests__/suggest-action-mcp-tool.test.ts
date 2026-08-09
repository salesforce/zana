import { describe, it, expect } from 'vitest';
import { registerSuggestActionTool } from '../suggest-action-mcp-tool.js';
import { createMemorySuggestionsStore } from '../suggestions-store.js';

type Handler = (input: Record<string, unknown>) => Promise<{ isError?: boolean; content: unknown[] }>;

function fakeServer() {
  const tools: Record<string, Handler> = {};
  return {
    registerTool: (name: string, _spec: unknown, handler: Handler) => {
      tools[name] = handler;
    },
    tools
  };
}

describe('suggest_action tool', () => {
  const REASON = 'why now';

  it('stamps projectId from opts, ignoring any input field', async () => {
    const store = createMemorySuggestionsStore();
    const srv = fakeServer();
    registerSuggestActionTool(srv as never, { projectId: 'route-proj', suggestionsStore: store });
    await srv.tools['suggest_action']({
      title: 'x',
      reason: REASON,
      action: { kind: 'start-terminal' },
      projectId: 'evil'
    });
    const { entries } = await store.read();
    expect(entries[0].projectId).toBe('route-proj');
    expect(entries[0].reason).toBe(REASON);
  });

  it('rejects an unknown action kind', async () => {
    const store = createMemorySuggestionsStore();
    const srv = fakeServer();
    registerSuggestActionTool(srv as never, { projectId: 'p', suggestionsStore: store });
    const res = await srv.tools['suggest_action']({ title: 'x', reason: REASON, action: { kind: 'nope' } });
    expect(res.isError).toBe(true);
    expect((await store.read()).entries.length).toBe(0);
  });

  it('rejects a standalone nav-only action (open-view / navigate)', async () => {
    const store = createMemorySuggestionsStore();
    const srv = fakeServer();
    registerSuggestActionTool(srv as never, { projectId: 'p', suggestionsStore: store });
    const openView = await srv.tools['suggest_action']({
      title: 'x',
      reason: REASON,
      action: { kind: 'open-view', nav: 'inbox' }
    });
    expect(openView.isError).toBe(true);
    const nav = await srv.tools['suggest_action']({
      title: 'x',
      reason: REASON,
      action: { kind: 'navigate', projectId: 'p' }
    });
    expect(nav.isError).toBe(true);
    expect((await store.read()).entries.length).toBe(0);
  });

  it('converts expiresInMinutes to expiresAt', async () => {
    // Store clock stays before the computed expiry so the entry isn't filtered.
    const store = createMemorySuggestionsStore(() => 0);
    const srv = fakeServer();
    registerSuggestActionTool(srv as never, {
      projectId: 'p',
      suggestionsStore: store,
      now: () => 60_000
    });
    await srv.tools['suggest_action']({
      title: 'x',
      reason: REASON,
      action: { kind: 'start-terminal' },
      expiresInMinutes: 5
    });
    expect((await store.read()).entries[0].expiresAt).toBe(60_000 + 5 * 60_000);
  });

  it('defaults expiry when expiresInMinutes is omitted', async () => {
    const store = createMemorySuggestionsStore(() => 0);
    const srv = fakeServer();
    registerSuggestActionTool(srv as never, {
      projectId: 'p',
      suggestionsStore: store,
      now: () => 1000
    });
    await srv.tools['suggest_action']({
      title: 'x',
      reason: REASON,
      action: { kind: 'start-terminal' }
    });
    // 4h default → 1000 + 240*60_000
    expect((await store.read()).entries[0].expiresAt).toBe(1000 + 240 * 60_000);
  });

  it('clamps field lengths and recurses combo steps (nav allowed as combo tail)', async () => {
    const store = createMemorySuggestionsStore();
    const srv = fakeServer();
    registerSuggestActionTool(srv as never, { projectId: 'p', suggestionsStore: store });
    await srv.tools['suggest_action']({
      title: 'x',
      reason: REASON,
      action: {
        kind: 'combo',
        steps: [
          { kind: 'start-terminal', cwd: 'c'.repeat(5000) },
          { kind: 'bogus' },
          { kind: 'open-view', nav: 'inbox' }
        ]
      }
    });
    const { entries } = await store.read();
    const action = entries[0].action as { kind: string; steps: Array<{ kind: string; cwd?: string }> };
    expect(action.kind).toBe('combo');
    // The bogus step is dropped; the cwd is clamped; the nav step survives (combo tail).
    expect(action.steps.map((s) => s.kind)).toEqual(['start-terminal', 'open-view']);
    expect(action.steps[0].cwd!.length).toBeLessThanOrEqual(1024);
  });

  it('rejects a combo whose steps all drop out', async () => {
    const store = createMemorySuggestionsStore();
    const srv = fakeServer();
    registerSuggestActionTool(srv as never, { projectId: 'p', suggestionsStore: store });
    const res = await srv.tools['suggest_action']({
      title: 'x',
      reason: REASON,
      action: { kind: 'combo', steps: [{ kind: 'bogus' }] }
    });
    expect(res.isError).toBe(true);
  });

  it('rejects a combo of only nav steps (no payload-bearing step)', async () => {
    const store = createMemorySuggestionsStore();
    const srv = fakeServer();
    registerSuggestActionTool(srv as never, { projectId: 'p', suggestionsStore: store });
    const res = await srv.tools['suggest_action']({
      title: 'x',
      reason: REASON,
      action: {
        kind: 'combo',
        steps: [
          { kind: 'open-view', nav: 'inbox' },
          { kind: 'navigate', projectId: 'p' }
        ]
      }
    });
    expect(res.isError).toBe(true);
    expect((await store.read()).entries.length).toBe(0);
  });
});
