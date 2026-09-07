import { describe, expect, it } from 'vitest';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import {
  parseCustomAcpAgents,
  RESERVED_ACP_PROVIDER_IDS,
  syncCustomAcpAgents
} from './configured-agents.js';

describe('parseCustomAcpAgents', () => {
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
