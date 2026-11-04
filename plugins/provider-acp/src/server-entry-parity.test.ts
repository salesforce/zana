import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import sourcePlugin from '../server.js';

const runtimePlugin = (await import(new URL('../server.mjs', import.meta.url).href)).default as typeof sourcePlugin;

async function customRegistrations(plugin: typeof sourcePlugin, entries: unknown[]) {
  const host = createFakePluginHost({ pluginId: 'provider-acp' });
  plugin(host.zcc);
  await Promise.resolve();
  host.harness.setSettings({ customAgents: JSON.stringify(entries) });
  return host.harness.providers.filter(entry => entry.id.startsWith('fixture-'));
}

describe('packaged ACP server entry', () => {
  it('keeps executable, cwd and environment metadata identical for health, discovery and sessions', async () => {
    const configured = { id: 'fixture-context', displayName: 'Context', command: '/path with spaces/agent', args: ['acp'], env: { MODE: 'configured' }, cwd: '/configured/project' };
    const defaults = { id: 'fixture-defaults', displayName: 'Defaults', command: 'agent' };
    const source = await customRegistrations(sourcePlugin, [configured, defaults]);
    const packaged = await customRegistrations(runtimePlugin, [configured, defaults]);
    expect(packaged).toHaveLength(2);
    for (let index = 0; index < packaged.length; index += 1) {
      const declaration = packaged[index]!;
      expect(declaration.experimental_bridgeOptions).toEqual(source[index]!.experimental_bridgeOptions);
      const sessionOptions = declaration.deriveProviderOptions?.({} as never);
      expect(sessionOptions).toEqual(source[index]!.deriveProviderOptions?.({} as never));
      expect(declaration.experimental_bridgeOptions).toEqual(sessionOptions);
    }
    expect(packaged[0]!.experimental_bridgeOptions).toMatchObject({
      acpLaunchSpec: { command: configured.command, args: configured.args, env: configured.env, cwd: configured.cwd }
    });
  });

  it.each([
    { command: 'bad\0command' }, { command: 'bad\ncommand' }, { command: 'bad\rcommand' },
    { args: ['bad\0argument'] }, { args: [123] }, { env: { 'BAD=KEY': 'value' } },
    { env: { KEY: 'bad\0value' } }, { env: { KEY: 123 } },
    { cwd: '' }, { cwd: '  ' }, { cwd: 123 }, { cwd: 'bad\0directory' },
  ])('rejects malformed custom launch settings in both entries: %j', async invalid => {
    const config = { id: 'fixture-invalid', displayName: 'Invalid', command: 'agent', ...invalid };
    expect(await customRegistrations(runtimePlugin, [config])).toEqual([]);
    expect(await customRegistrations(sourcePlugin, [config])).toEqual([]);
  });
});
