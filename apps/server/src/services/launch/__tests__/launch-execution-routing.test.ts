import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { preflightTerminalExecution } from '../execution-routing.js';
import { CursorProvider } from '@zana-ai/zcc-host-daemon/harness/cursor/provider';
import { CodexProvider } from '@zana-ai/zcc-host-daemon/harness/codex/provider';
import { OpenCodeProvider } from '@zana-ai/zcc-host-daemon/harness/opencode/provider';

const config = (executionState?: 'plan' | 'interactive' | 'accept-edits' | 'autonomous'): AppConfig => ({
  version: 1,
  theme: 'dark',
  harnessOpenCodeEnabled: true,
  nativeAgentDiscoveryEnabled: true,
  harnessRouting: executionState ? { schemaVersion: 1, byAdapter: { opencode: { executionState } } } : undefined
} as AppConfig);

describe('production execution routing preflight', () => {
  it('authorizes roles and models using the supplied machine discovery without running a local probe', async () => {
    const provider = new OpenCodeProvider();
    provider.discoverRoleTargets = vi.fn(async () => { throw new Error('wrong machine'); });
    provider.discoverModelTargets = vi.fn(async () => { throw new Error('wrong machine'); });
    const discovery = { roles: vi.fn(async () => [{ id: 'selected-role', label: 'Selected role', scope: ['local' as const] }]), models: vi.fn(async () => ['selected/model']) };
    const services = { consentStore: { reserve: vi.fn() }, installedVersion: vi.fn(async () => '1.18.10'), provider, discovery };
    const base = { config: config(), profile: 'opencode' as const, projectId: 'p', projectPath: '/selected/source', scope: 'local' as const, mode: 'interactive' as const, idempotencyKey: 'selected' };
    for (const selection of [{ roleTargetId: 'selected-role' }, { modelTargetId: 'selected/model' }]) {
      await expect(preflightTerminalExecution({ ...base, harnessRouting: { schemaVersion: 1, byAdapter: { opencode: selection } } }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    }
    discovery.roles.mockResolvedValueOnce([]);
    await expect(preflightTerminalExecution({ ...base, harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { roleTargetId: 'build' } } } }, services)).resolves.toEqual({ decision: 'blocked', reason: 'role target unavailable' });
    discovery.models.mockRejectedValueOnce(new Error('selected machine offline'));
    await expect(preflightTerminalExecution({ ...base, harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'selected/model' } } } }, services)).rejects.toThrow('selected machine offline');
    expect(provider.discoverRoleTargets).not.toHaveBeenCalled(); expect(provider.discoverModelTargets).not.toHaveBeenCalled();
  });

  it('does not infer an OpenCode portable level from opaque model names', async () => {
    const provider = new OpenCodeProvider();
    const discovery = { roles: vi.fn(async () => []), models: vi.fn(async () => [
      'fixture-provider/gpt-7-luna', 'fixture-provider/gpt-7-terra', 'fixture-provider/gpt-7-sol'
    ]) };
    const services = { ...deps(), provider, discovery };
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p', projectPath: '/selected/source', scope: 'local',
      mode: 'interactive', idempotencyKey: 'live-level', persona: { id: 'p', name: 'P', modelLevel: 'low' }
    }, services)).resolves.toEqual({
      decision: 'blocked', reason: 'OpenCode does not support low model level.'
    });
    expect(discovery.models).not.toHaveBeenCalled();
    expect(provider.adapter.descriptor.targets?.modelLevelMapping?.low).toBeUndefined();
  });
  const deps = () => ({
    consentStore: { reserve: vi.fn(async () => ({ outcome: 'denied' as const })) },
    installedVersion: vi.fn(async () => '1.18.10')
  });

  it.each(['local', 'remote'] as const)('allows ACP Agent default without probing a synthetic model on %s launches', async (scope) => {
    const provider = new OpenCodeProvider();
    const discovery = { roles: vi.fn(async () => []), models: vi.fn(async () => ['fixture-provider/real-model']) };
    const services = { ...deps(), provider, discovery };
    await expect(preflightTerminalExecution({
      config: { ...config(), harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'obsolete/model' } } } },
      profile: 'opencode', projectId: 'p', projectPath: '/selected/source', scope,
      mode: 'interactive', idempotencyKey: `agent-default-${scope}`,
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'acp-default' } } }
    }, services)).resolves.toEqual({ decision: 'allowed', scope });
    expect(discovery.models).not.toHaveBeenCalled();
    expect(services.installedVersion).not.toHaveBeenCalled();
  });

  it('still validates native roles when ACP Agent default is selected', async () => {
    const services = { ...deps(), discovery: { roles: vi.fn(async () => []), models: vi.fn(async () => []) } };
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p', projectPath: '/remote', scope: 'remote',
      mode: 'interactive', idempotencyKey: 'agent-default-missing-role',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'acp-default', roleTargetId: 'missing-role' } } }
    }, services)).resolves.toEqual({ decision: 'blocked', reason: 'role target unavailable' });
    expect(services.discovery.roles).toHaveBeenCalledOnce();
    expect(services.discovery.models).not.toHaveBeenCalled();
  });

  it('preserves native behavior when no structured execution target wins', async () => {
    const services = deps();
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', scope: 'local', mode: 'interactive', idempotencyKey: 'one'
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    expect(services.installedVersion).not.toHaveBeenCalled();
  });

  it('auto-activates structured OpenCode routing when the enable flag is unset', async () => {
    const services = deps();
    const unset = { version: 1, theme: 'dark' } as AppConfig;
    await expect(preflightTerminalExecution({
      config: unset, profile: 'opencode', projectId: 'p1', scope: 'local', mode: 'interactive',
      idempotencyKey: 'auto-on', harnessRouting: {
        schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'fixture-provider/gpt-6.1-sol' } }
      }
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });
  });

  it('blocks structured OpenCode routing when the operator explicitly hid the harness', async () => {
    const services = deps();
    await expect(preflightTerminalExecution({
      config: { ...config(), harnessOpenCodeEnabled: false }, profile: 'opencode', projectId: 'p1',
      scope: 'local', mode: 'interactive', idempotencyKey: 'hidden',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'fixture-provider/gpt-6.1-sol' } } }
    }, services)).resolves.toEqual({ decision: 'blocked', reason: 'selected harness is disabled' });
  });
  it('uses remote enablement and version without borrowing the coordinator installation', async () => {
    const services = { ...deps(), discovery: { roles: vi.fn(async () => []), models: vi.fn(async () => ['remote/model']) } };
    const input = { config: { ...config(), harnessOpenCodeEnabled: false }, profile: 'opencode' as const, projectId: 'p1',
      projectPath: '/remote', scope: 'remote' as const, mode: 'interactive' as const, idempotencyKey: 'remote-enabled',
      harnessRouting: { schemaVersion: 1 as const, byAdapter: { opencode: { modelTargetId: 'remote/model' } } } };
    await expect(preflightTerminalExecution(input, services)).resolves.toEqual({ decision: 'allowed', scope: 'remote' });
    services.installedVersion.mockResolvedValueOnce(undefined as never);
    await expect(preflightTerminalExecution(input, services)).resolves.toEqual({ decision: 'blocked', reason: 'selected harness is unavailable or has no verifiable version' });
  });

  it('allows approved exact OpenCode Plan routing', async () => {
    const services = deps();
    await expect(preflightTerminalExecution({
      config: config('plan'), profile: 'opencode', projectId: 'p1', scope: 'local', mode: 'interactive', idempotencyKey: 'one'
    }, services)).resolves.toMatchObject({ decision: 'allowed', scope: 'local', evidenceDigest: expect.any(String) });
    expect(services.consentStore.reserve).not.toHaveBeenCalled();
  });

  it('allows approved Persona facet and model target evidence', async () => {
    const services = deps();
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', scope: 'local', mode: 'interactive',
      idempotencyKey: 'facet', persona: { id: 'p', name: 'P', initialPrompt: 'start' }
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', scope: 'local', mode: 'interactive',
      idempotencyKey: 'model', harnessRouting: {
        schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'fixture-provider/gpt-6.1-sol' } }
      }
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });
  });

  it('preserves legacy Team persona facets without weakening explicit routing evidence', async () => {
    const services = deps();
    const persona = { id: 'p', name: 'P', initialPrompt: 'start', appendSystemPrompt: 'existing instructions' };
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', scope: 'local', mode: 'headless',
      idempotencyKey: 'legacy-team', persona, legacyPersonaFacetCompatibility: true
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });

    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', scope: 'local', mode: 'headless',
      idempotencyKey: 'legacy-team-explicit', persona, legacyPersonaFacetCompatibility: true,
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { executionState: 'plan' } } }
    }, services)).resolves.toMatchObject({ decision: 'allowed', scope: 'local', evidenceDigest: expect.any(String) });
  });

  it('allows an explicit native target with approved evidence', async () => {
    const services = deps();
    await expect(preflightTerminalExecution({
      config: config(),
      profile: 'opencode',
      projectId: 'p1',
      scope: 'local',
      mode: 'interactive',
      idempotencyKey: 'one',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { executionTargetId: 'opencode.execution.plan' } } }
    }, services)).resolves.toMatchObject({ decision: 'allowed', scope: 'local', evidenceDigest: expect.any(String) });
  });

  it('uses main-derived remote scope for OpenCode execution authorization', async () => {
    const services = deps();
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', scope: 'remote',
      mode: 'interactive', idempotencyKey: 'one',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { executionTargetId: 'opencode.execution.plan' } } }
    }, services)).resolves.toMatchObject({ decision: 'allowed', scope: 'remote', evidenceDigest: expect.any(String) });
  });

  it('allows an approved OpenCode model target on remote launches', async () => {
    const services = deps();
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', scope: 'remote',
      mode: 'interactive', idempotencyKey: 'remote-model',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'fixture-provider/gpt-6.1-sol' } } }
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'remote' });
  });

  it('blocks competing OpenCode native role and execution selectors', async () => {
    const services = deps();
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', projectPath: '/tmp/p1', scope: 'local',
      mode: 'interactive', idempotencyKey: 'role-execution',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { roleTargetId: 'build', executionState: 'plan' } } }
    }, services)).resolves.toEqual({
      decision: 'blocked',
      reason: 'OpenCode native role and execution state require one compatible role policy; clear one selection'
    });
  });

  it('allows an OpenCode native role with the unrestricted yolo profile', async () => {
    const services = deps();
    const provider = new OpenCodeProvider();
    provider.discoverAgentDescriptors = vi.fn(async () => ({ status: 'success' as const, descriptors: [
      { id: 'build', label: 'build', mode: 'primary' as const, hidden: false, directLaunchAllowed: true }
    ] }));
    await expect(preflightTerminalExecution({
      config: config(),
      profile: 'opencode-yolo',
      projectId: 'p1',
      projectPath: '/tmp/p1',
      scope: 'local',
      mode: 'interactive',
      idempotencyKey: 'yolo-role',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { roleTargetId: 'build' } } }
    }, { ...services, provider })).resolves.toEqual({ decision: 'allowed', scope: 'local' });
  });

  it.each(['local', 'remote'] as const)('validates the native role while ignoring its unused inherited tier on %s', async scope => {
    const provider = new OpenCodeProvider();
    const discovery = {
      roles: vi.fn(async () => [{ id: 'reviewer', label: 'Reviewer', scope: ['local' as const, 'remote' as const] }]),
      models: vi.fn(async () => ['fixture/model'])
    };
    const input = { config: config(), profile: 'opencode' as const, projectId: 'p', projectPath: '/owned/checkout',
      persona: { id: 'p', name: 'P', modelLevel: 'low' as const }, scope, mode: 'interactive' as const,
      idempotencyKey: `native-role-tier-${scope}`,
      harnessRouting: { schemaVersion: 1 as const, byAdapter: { opencode: { roleTargetId: 'reviewer' } } } };
    await expect(preflightTerminalExecution(input, { ...deps(), provider, discovery }))
      .resolves.toEqual({ decision: 'allowed', scope });
    expect(discovery.roles).toHaveBeenCalledTimes(1); expect(discovery.models).not.toHaveBeenCalled();
    discovery.roles.mockResolvedValueOnce([]);
    await expect(preflightTerminalExecution(input, { ...deps(), provider, discovery }))
      .resolves.toEqual({ decision: 'blocked', reason: 'role target unavailable' });
  });

  it('uses fresh authoritative direct-role discovery and rejects a subagent sharing a static id', async () => {
    const services = deps();
    const provider = new OpenCodeProvider();
    provider.discoverAgentDescriptors = vi.fn(async () => ({ status: 'success' as const, descriptors: [
      { id: 'build', label: 'build', mode: 'subagent' as const, hidden: false, directLaunchAllowed: false }
    ] }));
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', projectPath: '/tmp/p1', scope: 'local',
      mode: 'interactive', idempotencyKey: 'subagent-static-collision',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { roleTargetId: 'build' } } }
    }, { ...services, provider })).resolves.toEqual({ decision: 'blocked', reason: 'role target unavailable' });
    expect(provider.discoverAgentDescriptors).toHaveBeenCalledWith(
      { cwd: '/tmp/p1', config: expect.any(Object) }
    );
  });

  it('allows a freshly discovered direct OpenCode agent above the reviewed evidence floor', async () => {
    const services = deps();
    const provider = new OpenCodeProvider();
    provider.discoverAgentDescriptors = vi.fn(async () => ({ status: 'success' as const, descriptors: [
      { id: 'custom-reviewer', label: 'custom-reviewer', mode: 'primary' as const, hidden: false, directLaunchAllowed: true }
    ] }));
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', projectPath: '/tmp/p1', scope: 'local',
      mode: 'interactive', idempotencyKey: 'dynamic-direct-agent',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { roleTargetId: 'custom-reviewer' } } }
    }, { ...services, provider })).resolves.toEqual({ decision: 'allowed', scope: 'local' });
  });

  it('allows a discovered OpenCode role on Remote host (ssh -t) launches', async () => {
    const services = deps();
    const provider = new OpenCodeProvider();
    provider.discoverAgentDescriptors = vi.fn(async () => ({ status: 'success' as const, descriptors: [
      { id: 'general', label: 'general', mode: 'primary' as const, hidden: false, directLaunchAllowed: true }
    ] }));
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', projectPath: '/tmp/p1', scope: 'remote',
      mode: 'interactive', idempotencyKey: 'dynamic-direct-agent-remote',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { roleTargetId: 'general' } } }
    }, { ...services, provider })).resolves.toEqual({ decision: 'allowed', scope: 'remote' });
  });

  it.each([
    ['build', { decision: 'allowed', scope: 'local' }],
    ['custom-reviewer', { decision: 'blocked', reason: 'role target unavailable' }]
  ] as const)('falls back to static roles but rejects unavailable %s when authoritative OpenCode role discovery fails', async (roleTargetId, expected) => {
    const services = deps();
    const provider = new OpenCodeProvider();
    provider.discoverAgentDescriptors = vi.fn(async () => ({ status: 'failure' as const }));
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', projectPath: '/tmp/p1', scope: 'local',
      mode: 'interactive', idempotencyKey: `failed-discovery-${roleTargetId}`,
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { roleTargetId } } }
    }, { ...services, provider })).resolves.toEqual(expected);
  });

  it('allows a live Codex model/list id after catalog overlay stamps evidence', async () => {
    const services = deps();
    services.installedVersion = vi.fn(async () => '0.140.0');
    const provider = new CodexProvider();
    provider.setDiscoveredModels([
      { id: 'gpt-5.5', label: 'GPT-5.5', scope: ['local'] }
    ]);
    await expect(preflightTerminalExecution({
      config: { version: 1, theme: 'dark', harnessCodexEnabled: true } as AppConfig,
      profile: 'codex',
      projectId: 'p1',
      scope: 'local',
      mode: 'interactive',
      idempotencyKey: 'codex-live-model',
      harnessRouting: { schemaVersion: 1, byAdapter: { codex: { modelTargetId: 'gpt-5.5' } } }
    }, { ...services, provider })).resolves.toEqual({ decision: 'allowed', scope: 'local' });
  });

  it('allows a live Cursor --list-models id after catalog overlay stamps evidence', async () => {
    const services = deps();
    services.installedVersion = vi.fn(async () => '2026.08.15');
    const provider = new CursorProvider();
    provider.setDiscoveredModels([
      { id: 'auto', label: 'Auto', scope: ['local'] }
    ]);
    await expect(preflightTerminalExecution({
      config: { version: 1, theme: 'dark', harnessCursorEnabled: true } as AppConfig,
      profile: 'cursor',
      projectId: 'p1',
      scope: 'local',
      mode: 'interactive',
      idempotencyKey: 'cursor-live-model',
      harnessRouting: { schemaVersion: 1, byAdapter: { cursor: { modelTargetId: 'auto' } } }
    }, { ...services, provider })).resolves.toEqual({ decision: 'allowed', scope: 'local' });
  });

  it('allows a Codex thread-catalog id without waiting for model/list overlay', async () => {
    const services = deps();
    services.installedVersion = vi.fn(async () => '0.140.0');
    await expect(preflightTerminalExecution({
      config: { version: 1, theme: 'dark', harnessCodexEnabled: true } as AppConfig,
      profile: 'codex',
      projectId: 'p1',
      scope: 'local',
      mode: 'interactive',
      idempotencyKey: 'codex-thread-model',
      harnessRouting: { schemaVersion: 1, byAdapter: { codex: { modelTargetId: 'gpt-5.5' } } }
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });
  });

  it('allows a Cursor thread-catalog id without waiting for --list-models overlay', async () => {
    const services = deps();
    services.installedVersion = vi.fn(async () => '2026.08.15');
    await expect(preflightTerminalExecution({
      config: { version: 1, theme: 'dark', harnessCursorEnabled: true } as AppConfig,
      profile: 'cursor',
      projectId: 'p1',
      scope: 'local',
      mode: 'interactive',
      idempotencyKey: 'cursor-thread-model',
      harnessRouting: { schemaVersion: 1, byAdapter: { cursor: { modelTargetId: 'default' } } }
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    await expect(preflightTerminalExecution({
      config: { version: 1, theme: 'dark', harnessCursorEnabled: true } as AppConfig,
      profile: 'cursor',
      projectId: 'p1',
      scope: 'local',
      mode: 'interactive',
      idempotencyKey: 'cursor-thread-grok',
      harnessRouting: { schemaVersion: 1, byAdapter: { cursor: { modelTargetId: 'grok-4.6' } } }
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });
  });

  it('blocks a Cursor model target on Remote host launches and allows it on local scope', async () => {
    const services = deps();
    services.installedVersion = vi.fn(async () => '2026.08.15');
    const provider = new CursorProvider();
    provider.setDiscoveredModels([
      { id: 'auto', label: 'Auto', scope: ['local'] }
    ]);
    const routing = { schemaVersion: 1 as const, byAdapter: { cursor: { modelTargetId: 'auto' } } };
    const base = {
      config: { version: 1, theme: 'dark', harnessCursorEnabled: true } as AppConfig,
      profile: 'cursor' as const,
      projectId: 'p1',
      mode: 'interactive' as const,
      harnessRouting: routing
    };
    await expect(preflightTerminalExecution({
      ...base, scope: 'remote', idempotencyKey: 'cursor-remote-host'
    }, { ...services, provider })).resolves.toEqual({
      decision: 'blocked',
      reason: 'Cursor model target is unavailable for remote launches.'
    });
    await expect(preflightTerminalExecution({
      ...base, scope: 'local', idempotencyKey: 'cursor-remote-tools'
    }, { ...services, provider })).resolves.toEqual({ decision: 'allowed', scope: 'local' });
  });

  it('allows a live-listed Pi model when the static adapter catalog is empty', async () => {
    const services = deps();
    services.installedVersion = vi.fn(async () => '0.52.12');
    await expect(preflightTerminalExecution({
      config: { version: 1, theme: 'dark', harnessPiEnabled: true } as AppConfig,
      profile: 'pi',
      projectId: 'p1',
      scope: 'local',
      mode: 'interactive',
      idempotencyKey: 'pi-live-model',
      harnessRouting: { schemaVersion: 1, byAdapter: { pi: { modelTargetId: 'openai/gpt-5.2' } } }
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });
  });

  it('delegates an explicit OpenCode model to the CLI when no live probe is possible', async () => {
    const services = deps();
    await expect(preflightTerminalExecution({
      config: config(),
      profile: 'opencode',
      projectId: 'p1',
      scope: 'local',
      mode: 'interactive',
      idempotencyKey: 'unknown-catalog-model',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'openai/gpt-5.2' } } }
    }, services)).resolves.toEqual({
      decision: 'allowed', scope: 'local'
    });
  });

  it('allows an explicit OpenCode model listed in the live inventory', async () => {
    const services = deps();
    const provider = new OpenCodeProvider();
    provider.discoverModelTargets = vi.fn(async () => ['fixture-provider/gpt-6.0-nova-1M', 'fixture-provider/grok-5']);
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', projectPath: '/tmp/p1', scope: 'local',
      mode: 'interactive', idempotencyKey: 'drift-forward',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'fixture-provider/gpt-6.0-nova-1M' } } }
    }, { ...services, provider })).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    expect(provider.discoverModelTargets).toHaveBeenCalledWith({ cwd: '/tmp/p1', config: expect.any(Object) });
  });

  it.each(['local', 'remote'] as const)('checks exact live membership for an explicit provider/model pair on %s', async scope => {
    const provider = new OpenCodeProvider();
    const discovery = { roles: vi.fn(async () => []), models: vi.fn(async () => ['new-install-provider/model-v2']) };
    const input = { config: config(), profile: 'opencode' as const, projectId: 'p', projectPath: '/owned/project',
      scope, mode: 'interactive' as const, idempotencyKey: `provider-model-${scope}`,
      harnessRouting: { schemaVersion: 1 as const, byAdapter: { opencode: {
        providerTargetId: 'new-install-provider', modelTargetId: 'new-install-provider/model-v2'
      } } } };
    await expect(preflightTerminalExecution(input, { ...deps(), provider, discovery }))
      .resolves.toEqual({ decision: 'allowed', scope });
    expect(discovery.models).toHaveBeenCalledTimes(1);
    discovery.models.mockResolvedValueOnce(['new-install-provider/different-model']);
    await expect(preflightTerminalExecution(input, { ...deps(), provider, discovery }))
      .resolves.toEqual({ decision: 'blocked', reason: 'model target unavailable' });
  });

  it.each([
    { providerTargetId: 'new-install-provider' },
    { providerTargetId: 'different-provider', modelTargetId: 'new-install-provider/model-v2' },
    { providerTargetId: 'new-install-provider', modelTargetId: 'bad model' }
  ])('blocks invalid provider/model intent before probing (%j)', async intent => {
    const discovery = { roles: vi.fn(async () => []), models: vi.fn(async () => ['new-install-provider/model-v2']) };
    const decision = await preflightTerminalExecution({ config: config(), profile: 'opencode', projectId: 'p',
      projectPath: '/owned/project', scope: 'local', mode: 'interactive', idempotencyKey: 'invalid-provider-model',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: intent } }
    }, { ...deps(), provider: new OpenCodeProvider(), discovery });
    expect(decision.decision).toBe('blocked');
    expect(discovery.models).not.toHaveBeenCalled();
  });

  it('blocks an explicit OpenCode model absent from the available live inventory', async () => {
    const services = deps();
    const provider = new OpenCodeProvider();
    provider.discoverModelTargets = vi.fn(async () => ['fixture-provider/grok-4.6']);
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', projectPath: '/tmp/p1', scope: 'local',
      mode: 'interactive', idempotencyKey: 'drift-gone',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'fixture-provider/gpt-6.1-sol' } } }
    }, { ...services, provider })).resolves.toEqual({ decision: 'blocked', reason: 'model target unavailable' });
  });

  it('does not classify an explicit model as retired when the live probe is unavailable', async () => {
    const provider = new OpenCodeProvider();
    provider.discoverModelTargets = vi.fn(async () => undefined);
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', projectPath: '/tmp/p1', scope: 'local',
      mode: 'interactive', idempotencyKey: 'retired-model',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'fixture-provider/gpt-5.6-sol-1M' } } }
    }, { ...deps(), provider })).resolves.toEqual({ decision: 'allowed', scope: 'local' });
  });

  it('preserves an explicit model when the live probe is unavailable', async () => {
    const services = deps();
    const provider = new OpenCodeProvider();
    provider.discoverModelTargets = vi.fn(async () => undefined);
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', projectPath: '/tmp/p1', scope: 'local',
      mode: 'interactive', idempotencyKey: 'probe-unavailable',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'fixture-provider/gpt-6.1-sol' } } }
    }, { ...services, provider })).resolves.toEqual({ decision: 'allowed', scope: 'local' });
  });

  it('allows launching an unrestricted (yolo) profile without a per-tab execution target', async () => {
    const services = deps();
    await expect(preflightTerminalExecution({
      config: config(), profile: 'claude-yolo', projectId: 'p1', scope: 'local',
      mode: 'interactive', idempotencyKey: 'yolo'
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    expect(services.installedVersion).not.toHaveBeenCalled();
  });

  it('allows a thread-catalog Claude model id absent from the 4-alias snapshot', async () => {
    const services = deps();
    await expect(preflightTerminalExecution({
      config: { version: 1, theme: 'dark' } as AppConfig,
      profile: 'claude',
      projectId: 'p1',
      scope: 'local',
      mode: 'interactive',
      idempotencyKey: 'claude-thread-model',
      harnessRouting: { schemaVersion: 1, byAdapter: { claude: { modelTargetId: 'claude-opus-5[1m]' } } }
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    await expect(preflightTerminalExecution({
      config: { version: 1, theme: 'dark' } as AppConfig,
      profile: 'claude',
      projectId: 'p1',
      scope: 'local',
      mode: 'interactive',
      idempotencyKey: 'claude-sonnet-5',
      harnessRouting: { schemaVersion: 1, byAdapter: { claude: { modelTargetId: 'claude-sonnet-5' } } }
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });
  });

  it.each(['claude', 'cursor', 'codex', 'grok', 'mastracode'] as const)('allows default CLI Agent (Agent mode) for %s without structured routing', async (profile) => {
    const services = deps();
    await expect(preflightTerminalExecution({
      config: { version: 1, theme: 'dark' } as AppConfig,
      profile,
      projectId: 'p1',
      scope: 'local',
      mode: 'interactive',
      idempotencyKey: `cli-agent-${profile}`
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    expect(services.installedVersion).not.toHaveBeenCalled();
  });

  it.each([
    ['claude', '2.1.220', { claude: { executionState: 'plan' as const } }],
    ['cursor', '2026.01.23', { cursor: { executionState: 'plan' as const } }],
    ['codex', '0.140.0', { codex: { executionState: 'plan' as const } }]
  ] as const)('allows CLI Agent Plan routing for %s without blocking', async (profile, version, byAdapter) => {
    const services = {
      consentStore: { reserve: vi.fn(async () => ({ outcome: 'denied' as const })) },
      installedVersion: vi.fn(async () => version)
    };
    await expect(preflightTerminalExecution({
      config: { version: 1, theme: 'dark' } as AppConfig,
      profile,
      projectId: 'p1',
      scope: 'local',
      mode: 'interactive',
      idempotencyKey: `cli-plan-${profile}`,
      harnessRouting: { schemaVersion: 1, byAdapter }
    }, services)).resolves.toMatchObject({ decision: 'allowed', scope: 'local' });
  });

  it('allows CLI Agent Edits routing for Cursor without --force or consent', async () => {
    const services = {
      consentStore: { reserve: vi.fn(async () => ({ outcome: 'denied' as const })) },
      installedVersion: vi.fn(async () => '2026.01.23')
    };
    await expect(preflightTerminalExecution({
      config: { version: 1, theme: 'dark' } as AppConfig,
      profile: 'cursor',
      projectId: 'p1',
      scope: 'local',
      mode: 'interactive',
      idempotencyKey: 'cli-edits-cursor',
      harnessRouting: { schemaVersion: 1, byAdapter: { cursor: { executionState: 'accept-edits' } } }
    }, services)).resolves.toMatchObject({ decision: 'allowed', scope: 'local' });
    expect(services.consentStore.reserve).not.toHaveBeenCalled();
  });

  it('allows CLI Agent Edits for Mastra Code when --help has no semver', async () => {
    const services = {
      consentStore: { reserve: vi.fn(async () => ({ outcome: 'denied' as const })) },
      installedVersion: vi.fn(async () => 'Usage: mastracode --prompt <text> [options]\n--help, -h')
    };
    await expect(preflightTerminalExecution({
      config: { version: 1, theme: 'dark' } as AppConfig,
      profile: 'mastracode',
      projectId: 'p1',
      scope: 'local',
      mode: 'interactive',
      idempotencyKey: 'cli-edits-mastracode-help',
      harnessRouting: { schemaVersion: 1, byAdapter: { mastracode: { executionState: 'accept-edits' } } }
    }, services)).resolves.toMatchObject({ decision: 'allowed', scope: 'local' });
  });

  it('allows CLI Agent Edits routing for Grok as the native TUI', async () => {
    const services = {
      consentStore: { reserve: vi.fn(async () => ({ outcome: 'denied' as const })) },
      installedVersion: vi.fn(async () => '1.0.24')
    };
    await expect(preflightTerminalExecution({
      config: { version: 1, theme: 'dark' } as AppConfig,
      profile: 'grok',
      projectId: 'p1',
      scope: 'local',
      mode: 'interactive',
      idempotencyKey: 'cli-edits-grok',
      harnessRouting: { schemaVersion: 1, byAdapter: { grok: { executionState: 'accept-edits' } } }
    }, services)).resolves.toMatchObject({ decision: 'allowed', scope: 'local' });
    expect(services.consentStore.reserve).not.toHaveBeenCalled();
  });
});
