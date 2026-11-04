import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import {
  parseCustomAcpAgents,
  customAcpProviderDeclaration,
  RESERVED_ACP_PROVIDER_IDS,
  syncCustomAcpAgents
} from './configured-agents.js';

describe('parseCustomAcpAgents', () => {
  it('retains an explicit cwd and supplies the same launch for discovery and sessions', () => {
    const config = { id: 'acp-custom', displayName: 'Custom', command: '/bin/agent with spaces', args: ['acp'], env: { MODE: 'test' }, cwd: '/project' };
    const parsed = parseCustomAcpAgents(JSON.stringify(config));
    expect(parsed.agents).toEqual([config]);
    const declaration = customAcpProviderDeclaration(parsed.agents[0]!);
    const launch = { displayName: config.displayName, command: config.command, args: config.args, env: config.env, cwd: config.cwd };
    expect(declaration.experimental_bridgeOptions).toEqual({ acpLaunchSpec: launch });
    expect(declaration.deriveProviderOptions?.({} as never)).toEqual({ acpLaunchSpec: launch });
  });

  it.each([
    { command: 'bad\0command' }, { command: 'bad\ncommand' }, { command: 'bad\rcommand' },
    { args: ['bad\0argument'] }, { env: { 'BAD=KEY': 'value' } }, { env: { KEY: 'bad\0value' } },
    { cwd: '' }, { cwd: '  ' }, { cwd: 123 }, { cwd: 'bad\0directory' },
  ])('ignores malformed executable override %j', invalid => {
    expect(parseCustomAcpAgents(JSON.stringify({ id: 'acp-custom', displayName: 'Custom', command: 'agent', ...invalid })).agents).toEqual([]);
  });

  it('parses a JSON array and rejects reserved built-in ids', () => {
    expect(
      parseCustomAcpAgents(JSON.stringify([
        { id: 'acp-my-agent', displayName: 'Mine', command: 'mine', args: ['acp'], env: { FOO: '1' } },
        { id: 'acp-cursor', displayName: 'Nope', command: 'cursor-agent' },
        { id: 'codex', displayName: 'Nope', command: 'codex' }
      ]))
    ).toEqual({
      agents: [{
        id: 'acp-my-agent',
        displayName: 'Mine',
        command: 'mine',
        args: ['acp'],
        env: { FOO: '1' }
      }],
      rejectedIds: ['acp-cursor', 'codex']
    });
    expect(RESERVED_ACP_PROVIDER_IDS).toContain('acp-hermes-agent');
    expect(RESERVED_ACP_PROVIDER_IDS).toContain('acp-mastracode');
  });

  it('returns empty agents for malformed JSON', () => {
    expect(parseCustomAcpAgents('{')).toEqual({ agents: [], rejectedIds: [] });
  });
});

describe('syncCustomAcpAgents', () => {
  it('registers parsed agents and unregisters the previous set on reload', () => {
    const host = createFakePluginHost({ pluginId: 'provider-acp' });
    const first = syncCustomAcpAgents(
      host.zcc,
      JSON.stringify([{ id: 'acp-one', displayName: 'One', command: 'one' }]),
      []
    );
    expect(host.harness.providers.map((row) => row.id)).toEqual(['acp-one']);
    syncCustomAcpAgents(
      host.zcc,
      JSON.stringify([{ id: 'acp-two', displayName: 'Two', command: 'two' }]),
      first
    );
    expect(host.harness.providers.map((row) => row.id)).toEqual(['acp-two']);
  });
});
