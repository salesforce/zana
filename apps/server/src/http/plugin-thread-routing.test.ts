import { describe, expect, it, vi } from 'vitest';
import type {
  AppConfig,
  HarnessFamily,
  HarnessModelRoutingV1,
  LaunchProfileId,
  ProjectSettings
} from '@zana-ai/zcc-domain/product';
import type { LaunchProvider } from '@zana-ai/zcc-host-daemon/harness/launch-provider';
import { providerForFamily } from '@zana-ai/zcc-host-daemon/harness/registry';
import { PluginSpawnHarnessError } from './plugin-thread-spawn.js';
import {
  resolvePluginThreadRouting,
  slashPlanPromptInput,
  type PluginThreadRoutingInput
} from './plugin-thread-routing.js';

const HINT = 'Change it in Settings → AI Harness.';
const ALL_MODES = ['accept-edits', 'auto', 'full'] as const;

function realProvider(family: HarnessFamily): LaunchProvider {
  const provider = providerForFamily(family);
  if (!provider) throw new Error(`no provider for ${family}`);
  return provider;
}

/** Real provider with selected members overridden (prototype keeps every other real behavior). */
function variant(family: HarnessFamily, overrides: Record<string, unknown>): LaunchProvider {
  const base = realProvider(family);
  const derived = Object.create(base) as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides)) {
    Object.defineProperty(derived, key, { value, writable: true, configurable: true });
  }
  return derived as unknown as LaunchProvider;
}

function routing(family: HarnessFamily, entry: Record<string, unknown>): HarnessModelRoutingV1 {
  return { schemaVersion: 1, byAdapter: { [family]: entry } } as HarnessModelRoutingV1;
}

function input(overrides: Partial<PluginThreadRoutingInput> & { family: HarnessFamily }): PluginThreadRoutingInput {
  return {
    profile: overrides.family as LaunchProfileId,
    providerLabel: 'Thread X',
    config: {} as AppConfig,
    scope: 'local',
    permissionModes: ALL_MODES,
    acpModeOptions: async () => [],
    ...overrides
  };
}

async function failure(promise: Promise<unknown>): Promise<Error> {
  const caught = await promise.then(() => undefined, (error: unknown) => error);
  expect(caught).toBeInstanceOf(PluginSpawnHarnessError);
  return caught as Error;
}

const proj = (harnessRouting: HarnessModelRoutingV1) => ({ harnessRouting }) as unknown as ProjectSettings;

const msg = (text: string) => `Thread X cannot apply the AI harness override: ${text} ${HINT}`;

describe('resolvePluginThreadRouting — layering', () => {
  it('applies nothing when no layer overrides anything', async () => {
    const acpModeOptions = vi.fn(async () => []);
    await expect(resolvePluginThreadRouting(input({ family: 'claude', acpModeOptions }))).resolves.toEqual({ applied: [] });
    expect(acpModeOptions).not.toHaveBeenCalled();
  });

  it('layers Global → Project for the model, with the source of the winning layer', async () => {
    const config = { harnessRouting: routing('claude', { modelTargetId: 'haiku' }) } as unknown as AppConfig;
    const projectSettings = { harnessRouting: routing('claude', { modelTargetId: 'sonnet' }) } as unknown as ProjectSettings;

    await expect(resolvePluginThreadRouting(input({ family: 'claude', config }))).resolves.toEqual({
      model: 'haiku',
      applied: [{ field: 'model', value: 'haiku', source: 'global' }]
    });
    await expect(resolvePluginThreadRouting(input({ family: 'claude', config, projectSettings }))).resolves.toEqual({
      model: 'sonnet',
      applied: [{ field: 'model', value: 'sonnet', source: 'project' }]
    });
  });

  it('ignores project routing for another harness', async () => {
    const projectSettings = { harnessRouting: routing('codex', { modelTargetId: 'gpt-5.5' }) } as unknown as ProjectSettings;
    await expect(resolvePluginThreadRouting(input({ family: 'claude', projectSettings }))).resolves.toEqual({ applied: [] });
  });

  it('maps a project model level and a legacy global default model', async () => {
    await expect(resolvePluginThreadRouting(input({
      family: 'claude', projectSettings: { modelLevel: 'low' } as unknown as ProjectSettings
    }))).resolves.toEqual({ model: 'haiku', applied: [{ field: 'model', value: 'haiku', source: 'project' }] });
    await expect(resolvePluginThreadRouting(input({
      family: 'claude', config: { defaultModel: 'opus' } as unknown as AppConfig
    }))).resolves.toEqual({ model: 'opus', applied: [{ field: 'model', value: 'opus', source: 'global' }] });
  });

  it('uses the registered provider for the profile when no provider is injected', async () => {
    // Cursor's `auto` model is local-only in the real descriptor.
    const error = await failure(resolvePluginThreadRouting(input({
      family: 'cursor', scope: 'remote', projectSettings: proj(routing('cursor', { modelTargetId: 'auto' }))
    })));
    expect(error.message).toBe(msg('Cursor model target is unavailable for remote launches.'));
  });
});

describe('resolvePluginThreadRouting — resolver failures', () => {
  it('wraps a resolver Error in a PluginSpawnHarnessError with the settings hint', async () => {
    const error = await failure(resolvePluginThreadRouting(input({
      family: 'claude', projectSettings: proj(routing('claude', { modelTargetId: '-bad' }))
    })));
    expect(error.message).toBe(msg('Unknown model target for Claude Code.'));
  });

  it('rejects an unsupported model level', async () => {
    const error = await failure(resolvePluginThreadRouting(input({
      family: 'cursor', projectSettings: proj(routing('cursor', { modelLevel: 'low' }))
    })));
    expect(error.message).toBe(msg('Cursor does not support low model level.'));
  });

  it('wraps a non-Error throw via String()', async () => {
    const provider = variant('opencode', { roleContribution: () => { throw 'boom'; } });
    const error = await failure(resolvePluginThreadRouting(input({
      family: 'opencode', provider, projectSettings: proj(routing('opencode', { roleTargetId: 'build' }))
    })));
    expect(error.message).toBe(msg('boom.'));
  });

  it('rethrows a PluginSpawnHarnessError from a resolver unchanged', async () => {
    const provider = variant('opencode', {
      roleContribution: () => { throw new PluginSpawnHarnessError('already explained'); }
    });
    const error = await failure(resolvePluginThreadRouting(input({
      family: 'opencode', provider, projectSettings: proj(routing('opencode', { roleTargetId: 'build' }))
    })));
    expect(error.message).toBe('already explained');
  });

  it('treats project/global compatibility fields as a CLI Agent launch does', async () => {
    // A legacy compatibility model still applies; compatibility permission and
    // Codex sandbox/approval are read only at the per-tab layer, which an
    // inheriting spawn never sets (the project's own Codex fields are covered below).
    await expect(resolvePluginThreadRouting(input({
      family: 'claude', projectSettings: proj(routing('claude', { compatibility: { model: 'opus' } }))
    }))).resolves.toEqual({ model: 'opus', applied: [{ field: 'model', value: 'opus', source: 'project' }] });
    await expect(resolvePluginThreadRouting(input({
      family: 'claude', projectSettings: proj(routing('claude', { compatibility: { permissionMode: 'plan' } }))
    }))).resolves.toEqual({ applied: [] });
    await expect(resolvePluginThreadRouting(input({
      family: 'codex',
      config: { harnessRouting: routing('codex', { compatibility: { codexSandbox: 'read-only' } }) } as unknown as AppConfig,
      projectSettings: proj(routing('codex', { compatibility: { codexSandbox: 'danger-full-access', codexApproval: 'never' } }))
    }))).resolves.toEqual({ applied: [] });
  });

  it('lets an unrestricted (yolo) profile override an inherited execution state', async () => {
    await expect(resolvePluginThreadRouting(input({
      family: 'claude',
      profile: 'claude-yolo' as LaunchProfileId,
      projectSettings: proj(routing('claude', { executionState: 'plan' }))
    }))).resolves.toEqual({ permissionMode: 'full', applied: [] });
  });

  it('rejects a provider-reported routing combination (OpenCode role + execution state)', async () => {
    const error = await failure(resolvePluginThreadRouting(input({
      family: 'opencode',
      projectSettings: proj(routing('opencode', { roleTargetId: 'build', executionState: 'autonomous' }))
    })));
    expect(error.message).toBe(msg(
      'OpenCode native role and execution state require one compatible role policy; clear one selection.'
    ));
  });
});

describe('resolvePluginThreadRouting — native role', () => {
  it('applies a role that is a session mode and lets an OpenCode role pin the model', async () => {
    const acpModeOptions = vi.fn(async () => [{ value: 'build', name: 'Build' }, { value: 'plan', name: 'Plan' }]);
    const config = { harnessRouting: routing('opencode', { modelTargetId: 'llmgw/gpt-5.6-sol-1M' }) } as unknown as AppConfig;
    await expect(resolvePluginThreadRouting(input({
      family: 'opencode', config, acpModeOptions, projectSettings: proj(routing('opencode', { roleTargetId: 'build' }))
    }))).resolves.toEqual({
      acpMode: 'build',
      applied: [{ field: 'role', value: 'build', source: 'project' }]
    });
    expect(acpModeOptions).toHaveBeenCalledTimes(1);
  });

  it('applies the model alongside the role when the role does not pin it', async () => {
    const provider = variant('opencode', { nativeRolePinsModel: false });
    const projectSettings = {
      harnessRouting: routing('opencode', { roleTargetId: 'build', modelTargetId: 'llmgw/gpt-5.6-luna-1M' })
    } as unknown as ProjectSettings;
    await expect(resolvePluginThreadRouting(input({
      family: 'opencode', provider, projectSettings, acpModeOptions: async () => [{ value: 'build' }]
    }))).resolves.toEqual({
      acpMode: 'build',
      model: 'llmgw/gpt-5.6-luna-1M',
      applied: [
        { field: 'role', value: 'build', source: 'project' },
        { field: 'model', value: 'llmgw/gpt-5.6-luna-1M', source: 'project' }
      ]
    });
  });

  it('rejects a role that is not one of the thread provider session modes', async () => {
    const error = await failure(resolvePluginThreadRouting(input({
      family: 'opencode',
      config: { harnessRouting: routing('opencode', { roleTargetId: 'reviewer' }) } as unknown as AppConfig,
      acpModeOptions: async () => [{ value: 'build' }]
    })));
    expect(error.message).toBe(msg("native role reviewer is not one of this thread provider's session modes."));
  });

  it('reuses one session-mode read for role + plan and accepts a matching plan role', async () => {
    const provider = variant('opencode', { validateRoutingCombination: undefined });
    const acpModeOptions = vi.fn(async () => [{ value: 'build' }, { value: 'plan' }]);
    await expect(resolvePluginThreadRouting(input({
      family: 'opencode', provider, acpModeOptions,
      projectSettings: proj(routing('opencode', { roleTargetId: 'plan', executionState: 'plan' }))
    }))).resolves.toEqual({
      acpMode: 'plan',
      applied: [
        { field: 'role', value: 'plan', source: 'project' },
        { field: 'execution', value: 'plan', source: 'project' }
      ]
    });
    expect(acpModeOptions).toHaveBeenCalledTimes(1);
  });

  it('rejects a role that conflicts with the plan execution state', async () => {
    const provider = variant('opencode', { validateRoutingCombination: undefined });
    const error = await failure(resolvePluginThreadRouting(input({
      family: 'opencode', provider,
      acpModeOptions: async () => [{ value: 'build' }, { value: 'plan' }],
      projectSettings: proj(routing('opencode', { roleTargetId: 'build', executionState: 'plan' }))
    })));
    expect(error.message).toBe(msg('native role build conflicts with the plan execution state.'));
  });
});

describe('resolvePluginThreadRouting — execution', () => {
  it('gives an unrestricted profile full permission with nothing applied', async () => {
    await expect(resolvePluginThreadRouting(input({ family: 'claude', profile: 'claude-yolo' as LaunchProfileId })))
      .resolves.toEqual({ permissionMode: 'full', applied: [] });
    const error = await failure(resolvePluginThreadRouting(input({
      family: 'codex', profile: 'codex-yolo' as LaunchProfileId, permissionModes: ['accept-edits']
    })));
    expect(error.message).toBe(msg('the full permission mode is not supported by this thread provider.'));
  });

  it('maps portable states to thread permission modes with their layer source', async () => {
    await expect(resolvePluginThreadRouting(input({
      family: 'claude', projectSettings: proj(routing('claude', { executionState: 'autonomous' }))
    }))).resolves.toEqual({
      permissionMode: 'full', applied: [{ field: 'execution', value: 'autonomous', source: 'project' }]
    });
    await expect(resolvePluginThreadRouting(input({
      family: 'claude', projectSettings: { executionState: 'accept-edits' } as unknown as ProjectSettings
    }))).resolves.toEqual({
      permissionMode: 'accept-edits', applied: [{ field: 'execution', value: 'accept-edits', source: 'project' }]
    });
    await expect(resolvePluginThreadRouting(input({
      family: 'claude', config: { defaultExecutionState: 'interactive' } as unknown as AppConfig
    }))).resolves.toEqual({
      permissionMode: 'accept-edits', applied: [{ field: 'execution', value: 'interactive', source: 'global' }]
    });
  });

  it('rejects interactive where the harness maps it to a distinct native policy (Codex)', async () => {
    const error = await failure(resolvePluginThreadRouting(input({
      family: 'codex', projectSettings: proj(routing('codex', { executionState: 'interactive' }))
    })));
    expect(error.message).toBe(msg('the interactive execution state (workspace-write + untrusted) has no thread equivalent.'));
  });

  it('rejects a resolved permission mode the thread provider does not support', async () => {
    const error = await failure(resolvePluginThreadRouting(input({
      family: 'claude', permissionModes: ['accept-edits'], projectSettings: proj(routing('claude', { executionState: 'autonomous' }))
    })));
    expect(error.message).toBe(msg('the full permission mode is not supported by this thread provider.'));
  });

  it('applies plan through a native plan session mode', async () => {
    await expect(resolvePluginThreadRouting(input({
      family: 'claude',
      acpModeOptions: async () => [{ value: 'default', name: 'Default' }, { value: 'planning', name: 'Plan' }],
      projectSettings: proj(routing('claude', { executionState: 'plan' }))
    }))).resolves.toEqual({
      acpMode: 'planning', applied: [{ field: 'execution', value: 'plan', source: 'project' }]
    });
  });

  it('applies plan as /plan on slash-plan providers', async () => {
    await expect(resolvePluginThreadRouting(input({
      family: 'claude',
      composerActions: ['plan'],
      projectSettings: { executionState: 'plan' } as unknown as ProjectSettings
    }))).resolves.toEqual({
      slashPlan: true, applied: [{ field: 'execution', value: 'plan', source: 'project' }]
    });
  });

  it('rejects plan on a thread provider with neither a plan mode nor /plan', async () => {
    for (const composerActions of [undefined, ['compact']]) {
      const error = await failure(resolvePluginThreadRouting(input({
        family: 'claude',
        ...(composerActions ? { composerActions } : {}),
        acpModeOptions: async () => [{ value: 'default' }],
        projectSettings: proj(routing('claude', { executionState: 'plan' }))
      })));
      expect(error.message).toBe(msg('the plan execution state is not supported by this thread provider.'));
    }
  });
});

describe('resolvePluginThreadRouting — Codex native sandbox/approval', () => {
  const cases: Array<[Record<string, string>, 'accept-edits' | 'full', string]> = [
    [{ codexSandbox: 'workspace-write', codexApproval: 'on-request' }, 'accept-edits', 'workspace-write + on-request'],
    [{ codexSandbox: 'danger-full-access', codexApproval: 'never' }, 'full', 'danger-full-access + never']
  ];

  it.each(cases)('maps project policy %j to %s', async (policy, permissionMode, value) => {
    await expect(resolvePluginThreadRouting(input({
      family: 'codex', projectSettings: policy as unknown as ProjectSettings
    }))).resolves.toEqual({ permissionMode, applied: [{ field: 'execution', value, source: 'project' }] });
  });

  const rejected: Array<[Record<string, string>, string]> = [
    [{ codexSandbox: 'read-only' }, 'sandbox read-only + approval (Codex default)'],
    [{ codexSandbox: 'workspace-write', codexApproval: 'untrusted' }, 'sandbox workspace-write + approval untrusted'],
    [{ codexSandbox: 'danger-full-access', codexApproval: 'on-request' }, 'sandbox danger-full-access + approval on-request'],
    [{ codexApproval: 'never' }, 'sandbox (Codex default) + approval never'],
    // Half-set policies: a launch leaves the other half to Codex's own config.
    [{ codexSandbox: 'workspace-write' }, 'sandbox workspace-write + approval (Codex default)'],
    [{ codexApproval: 'on-request' }, 'sandbox (Codex default) + approval on-request'],
    [{ codexSandbox: 'danger-full-access' }, 'sandbox danger-full-access + approval (Codex default)']
  ];

  it.each(rejected)('rejects policy %j that a thread cannot express', async (policy, described) => {
    const error = await failure(resolvePluginThreadRouting(input({
      family: 'codex', projectSettings: policy as unknown as ProjectSettings
    })));
    expect(error.message).toBe(msg(
      `${described} has no thread equivalent (threads run workspace-write + on-request or danger-full-access + never).`
    ));
  });
});

describe('resolvePluginThreadRouting — launch fields a thread cannot carry', () => {
  it('rejects a project Claude permission mode, naming it', async () => {
    const error = await failure(resolvePluginThreadRouting(input({
      family: 'claude', projectSettings: { permissionMode: 'acceptEdits' } as unknown as ProjectSettings
    })));
    expect(error.message).toBe(msg('the project Claude Code permission mode (acceptEdits) has no thread equivalent.'));
  });

  it('ignores the project Claude permission mode under claude-yolo, as a launch does', async () => {
    await expect(resolvePluginThreadRouting(input({
      family: 'claude',
      profile: 'claude-yolo' as LaunchProfileId,
      projectSettings: { permissionMode: 'plan' } as unknown as ProjectSettings
    }))).resolves.toEqual({ permissionMode: 'full', applied: [] });
  });

  it('rejects global and project PI defaults, naming each', async () => {
    const error = await failure(resolvePluginThreadRouting(input({
      family: 'pi',
      config: { piProvider: 'anthropic', piThinking: 'high' } as unknown as AppConfig,
      projectSettings: { piModel: 'anthropic/claude-opus-4-8', piThinking: 'default' } as unknown as ProjectSettings
    })));
    expect(error.message).toBe(msg(
      'the global PI provider (anthropic), the global PI thinking level (high), '
      + 'the project PI model (anthropic/claude-opus-4-8) have no thread equivalent.'
    ));
  });

  it('accepts PI with no provider/model/thinking defaults set', async () => {
    await expect(resolvePluginThreadRouting(input({
      family: 'pi', projectSettings: { piThinking: 'default' } as unknown as ProjectSettings
    }))).resolves.toEqual({ applied: [] });
  });
});

describe('slashPlanPromptInput', () => {
  it('prefixes the prompt with a /plan command mention', () => {
    expect(slashPlanPromptInput('do it')).toEqual({
      text: '/plan do it',
      input: {
        type: 'text',
        text: '/plan do it',
        mentions: [{
          start: 0,
          end: 5,
          resource: {
            kind: 'command',
            trigger: '/',
            name: 'plan',
            source: 'command',
            origin: 'builtin',
            label: 'plan',
            argumentHint: null
          }
        }]
      }
    });
  });
});
