import { describe, expect, it } from 'vitest';
import { providerFor } from '../registry.js';
import { launchMetadataSnapshot } from '../session-metadata.js';

describe('launchMetadataSnapshot', () => {
  it('projects only trusted resolved labels into generic runtime metadata', () => {
    expect(launchMetadataSnapshot({
      provider: providerFor('opencode'),
      model: {
        targetId: 'llmgw/gpt-5.6-terra-1M', source: 'per-tab', structuredSelected: true, contribution: {}
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
          { label: 'Provider', value: 'OpenAI' },
          { label: 'Model', value: 'Terra' },
          { label: 'Role', value: 'Build' },
          { label: 'Execution', value: 'accept-edits' }
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

  it('does not expose an unmatched provider-native target id', () => {
    const snapshot = providerFor('opencode').launchMetadata({
      model: { targetId: 'provider/private-model', source: 'per-tab', structuredSelected: true, contribution: {} },
      role: { targetId: 'private-role', source: 'Agent', contribution: {} },
      execution: { origin: 'inherited-native-default', source: 'native-default', consentRequired: false, contribution: {} },
      observedAt: 123
    });

    expect(snapshot.sections[0].values).toContainEqual({ label: 'Model' });
    expect(snapshot.sections[0].values).toContainEqual({ label: 'Role' });
    expect(JSON.stringify(snapshot)).not.toContain('private');
  });
});
