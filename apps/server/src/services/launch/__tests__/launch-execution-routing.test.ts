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
  harnessRouting: executionState ? { schemaVersion: 1, byAdapter: { opencode: { executionState } } } : undefined
} as AppConfig);

describe('production execution routing preflight', () => {
  const deps = () => ({
    consentStore: { reserve: vi.fn(async () => ({ outcome: 'denied' as const })) },
    installedVersion: vi.fn(async () => '1.18.10')
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
        schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'llmgw/gpt-5.6-sol-1M' } }
      }
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });
  });

  it('blocks structured OpenCode routing when the operator explicitly hid the harness', async () => {
    const services = deps();
    await expect(preflightTerminalExecution({
      config: { ...config(), harnessOpenCodeEnabled: false }, profile: 'opencode', projectId: 'p1',
      scope: 'local', mode: 'interactive', idempotencyKey: 'hidden',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'llmgw/gpt-5.6-sol-1M' } } }
    }, services)).resolves.toEqual({ decision: 'blocked', reason: 'selected harness is disabled' });
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
        schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'llmgw/gpt-5.6-sol-1M' } }
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
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'llmgw/gpt-5.6-sol-1M' } } }
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

  it.each(['build', 'custom-reviewer'])('fails closed for %s when authoritative OpenCode role discovery fails', async (roleTargetId) => {
    const services = deps();
    const provider = new OpenCodeProvider();
    provider.discoverAgentDescriptors = vi.fn(async () => ({ status: 'failure' as const }));
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', projectPath: '/tmp/p1', scope: 'local',
      mode: 'interactive', idempotencyKey: `failed-discovery-${roleTargetId}`,
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { roleTargetId } } }
    }, { ...services, provider })).resolves.toEqual({ decision: 'blocked', reason: 'role target unavailable' });
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

  it('blocks a snapshot-absent OpenCode model when no live probe is possible (no project path)', async () => {
    // OpenCode live-lists models, so a well-formed snapshot-absent id no longer
    // hard-throws at resolution — but with no projectPath the live probe can't run,
    // so preflight falls back to the snapshot rule and blocks it (a non-empty
    // catalog rejects an unknown id) rather than letting it reach argv.
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
      decision: 'blocked',
      reason: 'model target unavailable'
    });
  });

  it('allows a snapshot-ABSENT OpenCode model that the LIVE gateway inventory lists (rename-forward drift)', async () => {
    // The gateway renamed a model to an id not yet in the release snapshot; the
    // live probe confirms it exists, so preflight accepts it.
    const services = deps();
    const provider = new OpenCodeProvider();
    provider.discoverModelTargets = vi.fn(async () => ['llmgw/gpt-6.0-nova-1M', 'llmgw/grok-5']);
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', projectPath: '/tmp/p1', scope: 'local',
      mode: 'interactive', idempotencyKey: 'drift-forward',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'llmgw/gpt-6.0-nova-1M' } } }
    }, { ...services, provider })).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    expect(provider.discoverModelTargets).toHaveBeenCalledWith({ cwd: '/tmp/p1', config: expect.any(Object) });
  });

  it('blocks a snapshot-PRESENT OpenCode model the LIVE gateway inventory no longer lists (prevents exit-64)', async () => {
    // The pinned id is still in the (stale) snapshot but the gateway dropped it;
    // the live probe is authoritative and blocks the spawn before it dies with
    // ProviderModelNotFoundError / exit 64 at runtime.
    const services = deps();
    const provider = new OpenCodeProvider();
    provider.discoverModelTargets = vi.fn(async () => ['llmgw/grok-4.6']);
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', projectPath: '/tmp/p1', scope: 'local',
      mode: 'interactive', idempotencyKey: 'drift-gone',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'llmgw/gpt-5.6-sol-1M' } } }
    }, { ...services, provider })).resolves.toEqual({ decision: 'blocked', reason: 'model target unavailable' });
  });

  it('falls back to snapshot evidence for a snapshot-present model when the live probe is unavailable', async () => {
    // A transient probe failure returns undefined — do not block a valid snapshot
    // id on it; fall back to the reviewed-evidence rule (which allows it).
    const services = deps();
    const provider = new OpenCodeProvider();
    provider.discoverModelTargets = vi.fn(async () => undefined);
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', projectPath: '/tmp/p1', scope: 'local',
      mode: 'interactive', idempotencyKey: 'probe-unavailable',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'llmgw/gpt-5.6-sol-1M' } } }
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

  it.each(['claude', 'cursor', 'codex'] as const)('allows default CLI Agent (Agent mode) for %s without structured routing', async (profile) => {
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
});
