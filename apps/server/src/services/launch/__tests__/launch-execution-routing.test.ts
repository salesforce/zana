import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { preflightTerminalExecution } from '../execution-routing.js';
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
        schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'aisuite/gpt-5.6-sol' } }
      }
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });
  });

  it('blocks structured OpenCode routing when the operator explicitly hid the harness', async () => {
    const services = deps();
    await expect(preflightTerminalExecution({
      config: { ...config(), harnessOpenCodeEnabled: false }, profile: 'opencode', projectId: 'p1',
      scope: 'local', mode: 'interactive', idempotencyKey: 'hidden',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'aisuite/gpt-5.6-sol' } } }
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
        schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'aisuite/gpt-5.6-sol' } }
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
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { modelTargetId: 'aisuite/gpt-5.6-sol' } } }
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
      { id: 'doc-vault', label: 'doc-vault', mode: 'primary' as const, hidden: false, directLaunchAllowed: true }
    ] }));
    await expect(preflightTerminalExecution({
      config: config(), profile: 'opencode', projectId: 'p1', projectPath: '/tmp/p1', scope: 'local',
      mode: 'interactive', idempotencyKey: 'dynamic-direct-agent',
      harnessRouting: { schemaVersion: 1, byAdapter: { opencode: { roleTargetId: 'doc-vault' } } }
    }, { ...services, provider })).resolves.toEqual({ decision: 'allowed', scope: 'local' });
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

  it('blocks a live-listed id on adapters that own a static model catalog', async () => {
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
      reason: 'Unknown model target for OpenCode.'
    });
  });

  it('allows launching an unrestricted (yolo) profile without a per-tab execution target', async () => {
    const services = deps();
    await expect(preflightTerminalExecution({
      config: config(), profile: 'claude-yolo', projectId: 'p1', scope: 'local',
      mode: 'interactive', idempotencyKey: 'yolo'
    }, services)).resolves.toEqual({ decision: 'allowed', scope: 'local' });
    expect(services.installedVersion).not.toHaveBeenCalled();
  });
});
