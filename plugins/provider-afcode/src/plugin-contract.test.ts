import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { readPluginManifest } from '@zana-ai/zcc-domain';
import plugin from '../server.js';
import artifact from '../server.mjs';

for (const [name, register] of [['source', plugin], ['artifact', artifact]] as const) {
  describe(`afcode plugin ${name}`, () => {
    it('registers truthful capabilities and both surfaces', async () => {
      const { zcc, harness } = createFakePluginHost({ pluginId: 'provider-afcode' });
      register(zcc);
      expect(harness.providers).toHaveLength(1);
      const provider = harness.providers[0]!;
      expect(provider).toMatchObject({ id: 'acp-afcode', capabilities: {
        fork: 'none', permissionModes: ['accept-edits', 'full'], supportsManualCompaction: false
      } });
      expect(provider.capabilities.reasoningLevels).toBeUndefined();
      expect(harness.ptyHarnesses[0]?.profiles.map((p) => p.id)).toEqual(['afcode', 'afcode-resume', 'afcode-yolo']);
      await harness.dispose();
    });
    it.each([undefined, '', '  ', '/tmp/bin with spaces/afcode', 'afcode-dev'])(
      'uses the executable setting as argv command: %s', async (executable) => {
        const { zcc, harness } = createFakePluginHost({ pluginId: 'provider-afcode' });
        register(zcc);
        const result = harness.providers[0]!.deriveProviderOptions!({
          projectId: 'project', threadId: 'thread', permissionMode: 'full', settings: { executable }
        });
        expect(result).toEqual({ acpDialect: 'generic', acpLaunchSpec: {
          displayName: 'afcode', command: executable?.trim() || 'afcode', args: ['acp'], env: {}
        } });
        await harness.dispose();
      }
    );
  });
}
it('ships the shared ACP host bridge and native planner', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  expect(readPluginManifest(pkg)).toMatchObject({ hostEntry: './host.ts', ptyEntry: './pty.ts', appEntry: null });
  const source = readFileSync(new URL('../host.ts', import.meta.url), 'utf8');
  expect(source).toContain('experimental_acpProviderBridge as experimental_providerBridge');
});
