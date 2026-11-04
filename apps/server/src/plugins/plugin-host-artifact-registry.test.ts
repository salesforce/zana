import { describe, expect, it } from 'vitest';
import { PluginHostArtifactRegistry } from './plugin-host-artifact-registry.js';

describe('PluginHostArtifactRegistry', () => {
  it('retains active generations and closes admission until update finishes', () => {
    const registry = new PluginHostArtifactRegistry();
    const artifact = { path: '/tmp/host.js', digest: 'ab'.repeat(32), byteLength: 32, generation: 'g1' };
    registry.set('sample', artifact);
    const a = registry.acquire('sample'), b = registry.acquire('sample');
    expect(() => registry.beginUpdate('sample')).toThrow('active host call');
    a(); a(); expect(() => registry.beginUpdate('sample')).toThrow('active host call'); b();
    const resume = registry.beginUpdate('sample');
    expect(registry.get('sample')).toBeUndefined(); expect(registry.peek('sample')).toBe(artifact);
    expect(() => registry.acquire('sample')).toThrow('update in progress');
    expect(() => registry.beginUpdate('sample')).toThrow('already in progress');
    registry.set('sample', { ...artifact, generation: 'g2' }); resume(); resume();
    expect(registry.get('sample')?.generation).toBe('g2'); registry.acquire('sample')();
  });
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
