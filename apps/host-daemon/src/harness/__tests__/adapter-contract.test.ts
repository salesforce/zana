import { describe, expect, it } from 'vitest';
import { availabilityFromVerify } from '@zana-ai/zcc-domain/harness-adapter';
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
    expect(seen.size).toBe(14);
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
});
