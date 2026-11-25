import { VALID_PROFILES } from '@zana-ai/zcc-domain/launch-provider';
import { describe, expect, it } from 'vitest';
import { availabilityFromVerify } from '@zana-ai/zcc-domain/harness-adapter';
import type { HarnessApiErrorSignal, HarnessStatusAdapter } from '@zcc/harness-sdk';
import { HARNESS_SETTINGS_CONTRIBUTIONS, hasNativeOption, validateConfigFiles } from '../adapter-contract.js';
import { harnessAdapterDescriptors, registeredAdapters } from '../registry.js';

describe('trusted harness adapter contract', () => {
  it('assigns every registered profile to exactly one trusted adapter with a posture', () => {
    const seen = new Set<string>();
    for (const provider of registeredAdapters()) {
      for (const profile of provider.adapter.descriptor.profiles) {
        expect(seen.has(profile.id), profile.id).toBe(false);
        seen.add(profile.id);
        expect(profile.posture).toBeTruthy();
      }
    }
    expect(seen.size).toBe(VALID_PROFILES.length);
  });

  it('keeps shell terminal-only and every agent-default adapter profile-backed', () => {
    for (const provider of registeredAdapters()) {
      const descriptor = provider.adapter.descriptor;
      if (descriptor.agentDefaultEligible) expect(descriptor.defaultProfileId).toBeTruthy();
    }
    expect(registeredAdapters().find((provider) => provider.adapter.descriptor.id === 'shell')?.adapter.descriptor.agentDefaultEligible).toBe(false);
  });

  it('builds safe descriptors from trusted registrations and supplied availability only', () => {
    const descriptors = harnessAdapterDescriptors(new Map([
      ['claude', { enabled: true, installed: true, version: '1.2.3' }]
    ]));
    expect(descriptors.find((entry) => entry.id === 'claude')?.availability.version).toBe('1.2.3');
    expect(descriptors.find((entry) => entry.id === 'codex')?.availability.reason).toBe('Verification required');
  });

  it('marks disabled and missing verified harnesses unavailable with honest reasons', () => {
    expect(availabilityFromVerify('codex', { family: 'codex', label: 'Codex', binary: 'codex', enabled: false, alwaysEnabled: false, installed: true, installHint: '' }).reason).toBe('Disabled');
    expect(availabilityFromVerify('codex', { family: 'codex', label: 'Codex', binary: 'codex', enabled: true, alwaysEnabled: false, installed: false, installHint: '' }).reason).toBe('Binary not found');
  });

  it('registers each settings contribution against its owning trusted adapter', () => {
    const adapterIds = new Set(registeredAdapters().map(({ adapter }) => adapter.descriptor.id));
    const contributionIds = new Set<string>(HARNESS_SETTINGS_CONTRIBUTIONS.map((contribution) => contribution.id));
    for (const contribution of HARNESS_SETTINGS_CONTRIBUTIONS) {
      expect(adapterIds.has(contribution.adapterId)).toBe(true);
    }
    for (const provider of registeredAdapters()) {
      for (const id of provider.adapter.descriptor.settingsContributionIds) {
        expect(contributionIds.has(id), id).toBe(true);
      }
    }
  });

  it('detects split and attached native options without changing raw argv', () => {
    const grammar = [{ names: ['--model', '-m'], arity: 1 as const, acceptsAttachedValue: true }];
    expect(hasNativeOption(['--model', 'x'], grammar, true)).toBe(true);
    expect(hasNativeOption(['--model=x'], grammar, true)).toBe(true);
    expect(hasNativeOption(['-mx'], grammar, true)).toBe(true);
    expect(hasNativeOption(['--', '--model', 'x'], grammar, true)).toBe(false);
  });

  it('declares deliberate config-file behavior for every trusted adapter', () => {
    for (const provider of registeredAdapters()) {
      expect(provider.adapter.descriptor.configFiles.length).toBeGreaterThan(0);
      expect(() => validateConfigFiles(provider.adapter.descriptor)).not.toThrow();
    }
  });

  // #649 REQ-1, REQ-2: every agent-capable adapter declares how it reports API errors.
  describe('API-error signal declaration', () => {
    const ALLOWED: readonly HarnessApiErrorSignal[] = ['hook', 'sdk-events', 'screen-scan', 'none'];
    const canRunAgent = (adapter: { descriptor: { agentDefaultEligible?: boolean; profiles: readonly { id: string }[] } }) =>
      Boolean(adapter.descriptor.agentDefaultEligible) || adapter.descriptor.profiles.some((profile) => profile.id !== 'shell');

    /** The contract: what a trusted adapter's status must satisfy. Returns the first problem, or null. */
    function apiErrorSignalProblem(status: Partial<HarnessStatusAdapter> | undefined): string | null {
      if (!status) return 'no status';
      const signal = status.apiErrorSignal;
      if (!signal || !ALLOWED.includes(signal)) return 'apiErrorSignal missing or not allowed';
      if (signal === 'hook' && !status.interactionHook) return "'hook' declared without an interactionHook";
      return null;
    }

    it('requires an explicit allowed apiErrorSignal on every adapter that can run an agent', () => {
      for (const { adapter } of registeredAdapters()) {
        if (!canRunAgent(adapter)) continue;
        expect(apiErrorSignalProblem(adapter.status), adapter.descriptor.id).toBeNull();
      }
    });

    it('rejects an adapter that omits the field or declares hook without a hook', () => {
      expect(apiErrorSignalProblem({ mode: 'osc' })).toMatch(/missing/);
      expect(apiErrorSignalProblem({ mode: 'osc', apiErrorSignal: 'hook' })).toMatch(/without an interactionHook/);
      expect(apiErrorSignalProblem({ mode: 'osc', apiErrorSignal: 'bogus' as HarnessApiErrorSignal })).toMatch(/missing or not allowed/);
      expect(apiErrorSignalProblem(undefined)).toBe('no status');
      expect(apiErrorSignalProblem({ mode: 'osc', apiErrorSignal: 'hook', interactionHook: () => null })).toBeNull();
    });

    it('makes the field required by type', () => {
      // @ts-expect-error apiErrorSignal is required on HarnessStatusAdapter
      const omitted: HarnessStatusAdapter = { mode: 'osc' };
      expect(omitted.mode).toBe('osc');
    });

    it('declares hook for Claude, which provides the hook', () => {
      const claude = registeredAdapters().find(({ adapter }) => adapter.descriptor.id === 'claude')!.adapter;
      expect(claude.status?.apiErrorSignal).toBe('hook');
      expect(claude.status?.interactionHook).toBeTypeOf('function');
    });

    it('declares sdk-events with a producer for Codex, whose hook never claims an API-error stop', () => {
      const codex = registeredAdapters().find(({ adapter }) => adapter.descriptor.id === 'codex')!.adapter;
      expect(codex.status?.apiErrorSignal).toBe('sdk-events');
      expect(codex.status?.apiErrorProducer).toBeDefined();
    });

    it.each([['opencode', 'screen-scan'], ['pi', 'sdk-events']])('declares a producer for %s (%s) without a hook', (id, signal) => {
      const adapter = registeredAdapters().find((provider) => provider.adapter.descriptor.id === id)?.adapter;
      expect(adapter, id).toBeDefined();
      expect(adapter!.status?.apiErrorSignal).toBe(signal);
      expect(adapter!.status?.apiErrorProducer).toBeDefined();
      expect(adapter!.status?.interactionHook).toBeUndefined();
    });

    it.each(['cursor', 'grok', 'mastracode', 'afcode'])('declares none for %s', (id) => {
      const adapter = registeredAdapters().find((provider) => provider.adapter.descriptor.id === id)?.adapter;
      expect(adapter, id).toBeDefined();
      expect(adapter!.status?.apiErrorSignal).toBe('none');
    });
  });
});
