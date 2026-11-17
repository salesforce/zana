import { describe, expect, it } from 'vitest';
import { providerFor } from '../registry.js';
import { withLiveModelTargets } from '../launch-provider.js';
import { launchMetadataSnapshot, metadataSourceLabel } from '../session-metadata.js';

describe('launchMetadataSnapshot', () => {
  it('projects only trusted resolved labels into generic runtime metadata', () => {
    expect(launchMetadataSnapshot({
      provider: withLiveModelTargets(providerFor('opencode'), ['fixture-provider/fixture-model']),
      model: {
        targetId: 'fixture-provider/fixture-model', source: 'per-tab', structuredSelected: true, contribution: {}
      },
      role: { targetId: 'build', source: 'Agent', contribution: {} },
      execution: {
        state: 'accept-edits', targetId: 'opencode.accept-edits', origin: 'explicit-native',
        source: 'Agent', consentRequired: false, contribution: {}
      },
      observedAt: 123,
      axes: ['provider', 'model', 'role', 'execution']
    })).toEqual({
      observedAt: 123,
      sections: [{
        id: 'runtime',
        label: 'Runtime',
        values: [
          { label: 'Provider', value: 'fixture-provider' },
          { label: 'Model', value: 'fixture-provider/fixture-model', source: 'Agent' },
          { label: 'Role', value: 'Build', source: 'Agent' },
          { label: 'Execution', value: 'accept-edits', source: 'Agent' }
        ]
      }]
    });
  });

  it('omits redundant Claude metadata already supplied by its session UI', () => {
    const snapshot = providerFor('claude').launchMetadata({
      model: { source: 'native-default', structuredSelected: false, contribution: {} },
      role: { source: 'native-default', contribution: {} },
      execution: { origin: 'inherited-native-default', source: 'native-default', consentRequired: false, contribution: {} },
      observedAt: 123
    });

    expect(snapshot.sections).toEqual([]);
  });

  it('does not infer absent target values from mutable configuration', () => {
    const snapshot = providerFor('pi').launchMetadata({
      model: { source: 'native-default', structuredSelected: false, contribution: {} },
      role: { source: 'native-default', contribution: {} },
      execution: { origin: 'inherited-native-default', source: 'native-default', consentRequired: false, contribution: {} },
      observedAt: 123
    });

    expect(snapshot.sections).toEqual([]);
  });

  it('omits OpenCode role when no agent profile was selected', () => {
    const snapshot = providerFor('opencode').launchMetadata({
      model: { source: 'native-default', structuredSelected: false, contribution: {} },
      role: { source: 'native-default', contribution: {} },
      execution: { origin: 'inherited-native-default', source: 'native-default', consentRequired: false, contribution: {} },
      observedAt: 123
    });

    expect(snapshot.sections).toEqual([]);
  });

  it('omits unsupported runtime types instead of showing them unavailable', () => {
    const snapshot = providerFor('shell').launchMetadata({
      model: { source: 'native-default', structuredSelected: false, contribution: {} },
      role: { source: 'native-default', contribution: {} },
      execution: { origin: 'inherited-native-default', source: 'native-default', consentRequired: false, contribution: {} },
      observedAt: 123
    });

    expect(snapshot.sections).toEqual([]);
  });

  it('omits unmatched provider-native targets instead of showing unavailable values', () => {
    const snapshot = providerFor('opencode').launchMetadata({
      model: { targetId: 'provider/private-model', source: 'per-tab', structuredSelected: true, contribution: {} },
      role: { targetId: 'private-role', source: 'Agent', contribution: {} },
      execution: { origin: 'inherited-native-default', source: 'native-default', consentRequired: false, contribution: {} },
      observedAt: 123
    });

    expect(snapshot.sections).toEqual([]);
    expect(JSON.stringify(snapshot)).not.toContain('private');
  });
});

describe('metadataSourceLabel', () => {
  it('maps all three resolver vocabularies to one display label', () => {
    expect(metadataSourceLabel('per-tab')).toBe('Agent');
    expect(metadataSourceLabel('Agent')).toBe('Agent');
    expect(metadataSourceLabel('persona')).toBe('Persona');
    expect(metadataSourceLabel('Project')).toBe('Project');
    expect(metadataSourceLabel('global')).toBe('Global');
    expect(metadataSourceLabel('native-default')).toBe('Native default');
  });

  it('returns undefined for unknown or missing sources', () => {
    expect(metadataSourceLabel('bogus')).toBeUndefined();
    expect(metadataSourceLabel(undefined)).toBeUndefined();
  });
});
