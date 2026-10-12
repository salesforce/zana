import { expect, it } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import claude from '../../../../../plugins/provider-claude-code/server.js';
import codex from '../../../../../plugins/provider-codex/server.js';
import acp from '../../../../../plugins/provider-acp/server.js';
import pi from '../../../../../plugins/provider-pi/server.js';

function declarations(plugin: (zcc: any) => void) {
  const host = createFakePluginHost({ pluginId: 'provider-test' });
  plugin(host.zcc);
  return host.harness.providers.map((row) => ({
    id: row.id,
    skills: row.experimental_nativeSkillRoots,
    commands: row.experimental_nativeCommandRoots,
    resolves: row.experimental_resolvesNativeRoots
  }));
}
for (const [name, typed] of [
  ['provider-claude-code', claude],
  ['provider-codex', codex],
  ['provider-acp', acp]
] as const) {
  it(`${name} retained-source registration matches typed native declarations`, async () => {
    const retained = await import(pathToFileURL(resolve('plugins', name, 'server.mjs')).href);
    expect(declarations(retained.default)).toEqual(declarations(typed));
    expect(declarations(typed).some((row) => row.skills || row.commands)).toBe(true);
  });
}
it('Pi registers native discovery on its shipped server entry', () => {
  expect(declarations(pi)).toEqual([
    expect.objectContaining({
      id: 'pi',
      resolves: true,
      skills: expect.objectContaining({ user: ['.pi/agent/skills', '.agents/skills'] })
    })
  ]);
});
