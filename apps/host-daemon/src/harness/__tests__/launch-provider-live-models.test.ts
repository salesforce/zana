import { describe, expect, it } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import * as launchProvider from '../launch-provider.js';
import { withLiveModelTargets, type LaunchProvider } from '../launch-provider.js';
import { OpenCodeProvider } from '../opencode/provider.js';
import { providerFor } from '../registry.js';
import { resolveModelTarget } from '../target-resolution.js';

const CONFIG = { version: 1, theme: 'dark' } as AppConfig;

describe('launch-scoped live model inventory', () => {
  it('keeps no keyed inventory store: a spawn can only see the pin its own preflight authorized', () => {
    // The per-(adapter, cwd) TTL record was removed — sibling slots sharing one
    // worktree cwd (or two machines with the same checkout path) overwrote each
    // other's preflighted inventory. Nothing keyed may come back.
    expect(Object.keys(launchProvider)).not.toEqual(expect.arrayContaining(['recordLiveModelTargets']));
    for (const removed of ['recordLiveModelTargets', 'liveModelTargetsFor', 'clearLiveModelTargets', 'launchScopedProvider']) {
      expect(launchProvider).not.toHaveProperty(removed);
    }
  });

  it('withLiveModelTargets is a pure per-call view that never touches the shared provider', () => {
    const shared = new OpenCodeProvider();
    const snapshot = shared.adapter;
    const view = withLiveModelTargets(shared, ['fixture-provider/gpt-7-luna']);
    expect(view.adapter.descriptor.targets?.models.map(model => model.id)).toEqual(['fixture-provider/gpt-7-luna']);
    expect(view.adapter.descriptor.targets?.providers).toEqual([{ id: 'fixture-provider', label: 'fixture-provider' }]);
    expect(view.adapter.descriptor.targets?.modelLevelMapping.low).toBeUndefined();
    expect(shared.adapter).toBe(snapshot);
    const plain = providerFor('claude');
    expect(withLiveModelTargets(plain as LaunchProvider, ['x/one'])).toBe(plain);
  });

  it('an authorized model pin is used verbatim for its adapter + level only', () => {
    const shared = new OpenCodeProvider();
    const input = {
      config: CONFIG,
      persona: { id: 'p', name: 'P', modelLevel: 'low' as const },
      profile: 'opencode' as const,
      extraArgs: [],
      scope: 'local' as const
    };
    const pin = { adapterId: 'opencode', level: 'low' as const, targetId: 'fixture-provider/gpt-7-luna' };
    expect(resolveModelTarget(shared, { ...input, authorizedModel: pin })).toMatchObject({
      targetId: 'fixture-provider/gpt-7-luna', level: 'low', contribution: { args: ['--model', 'fixture-provider/gpt-7-luna'] }
    });
    // A pin for another level or adapter never re-routes this launch.
    expect(() => resolveModelTarget(shared, { ...input, authorizedModel: { ...pin, level: 'high' } })).toThrow('does not support low model level');
    expect(() => resolveModelTarget(shared, { ...input, authorizedModel: { ...pin, adapterId: 'codex' } })).toThrow('does not support low model level');
    // Explicit ids stay verbatim regardless of a pin.
    expect(resolveModelTarget(shared, {
      ...input,
      persona: undefined,
      perTabRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'fixture-provider/grok-4.6' } } },
      authorizedModel: pin
    }).targetId).toBe('fixture-provider/grok-4.6');
  });
});
