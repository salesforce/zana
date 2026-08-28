import { describe, expect, it } from 'vitest';
import { PluginHostArtifactRegistry } from './plugin-host-artifact-registry.js';

describe('PluginHostArtifactRegistry', () => {
  it('publishes, reads, and deletes a snapshot', () => {
    const registry = new PluginHostArtifactRegistry();
    const snapshot = {
      path: '/tmp/host.js',
      digest: 'ab'.repeat(32),
      byteLength: 32,
      generation: 'g1'
    };
    expect(registry.get('provider-acp')).toBeUndefined();
    registry.set('provider-acp', snapshot);
    expect(registry.get('provider-acp')).toEqual(snapshot);
    expect([...registry.entries()]).toEqual([['provider-acp', snapshot]]);
    registry.delete('provider-acp');
    expect(registry.get('provider-acp')).toBeUndefined();
  });
});
