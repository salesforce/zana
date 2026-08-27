import { describe, expect, it } from 'vitest';
import type { PluginAgentToolRegistration } from '@zana-ai/zcc-plugin-sdk/server';
import {
  HOST_SESSION_INSTRUCTIONS_MAX,
  HOST_SESSION_TOOLS_MAX,
  invokePluginAgentTool,
  packHostSessionTooling,
  resolvePluginSessionTools,
  safePackPluginSession,
  toDynamicTool,
  type PluginAgentToolSource
} from './plugin-agent-tools.js';

function tool(
  name: string,
  execute: PluginAgentToolRegistration['execute'] = async (input) => input
): PluginAgentToolRegistration {
  return {
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    execute
  };
}

function source(partial: Partial<PluginAgentToolSource> & { pluginId: string }): PluginAgentToolSource {
  return {
    tools: [],
    ...partial
  };
}

describe('toDynamicTool', () => {
  it('fills an empty object schema when inputSchema is omitted', () => {
    expect(toDynamicTool({
      name: 'bare',
      description: 'Bare',
      execute: async () => undefined
    })).toEqual({
      name: 'bare',
      description: 'Bare',
      inputSchema: { type: 'object', properties: {} }
    });
  });
});

describe('resolvePluginSessionTools', () => {
  it('includes every registered tool when a plugin has no configure()', async () => {
    const session = await resolvePluginSessionTools([
      source({
        pluginId: 'notes',
        tools: [tool('note_search'), tool('note_read')],
        extraInstructions: ['  Keep notes short.  ']
      })
    ], { threadId: 'thr-1', projectId: 'proj-1' });
    expect(session.tools.map((row) => row.name)).toEqual(['note_search', 'note_read']);
    expect(session.instructions).toBe('Keep notes short.');
  });

  it('omits tools when configure() returns an empty object', async () => {
    const session = await resolvePluginSessionTools([
      source({
        pluginId: 'salesforce',
        tools: [tool('sf_soql'), tool('sf_apex')],
        configurers: [() => ({})]
      })
    ], { threadId: 'thr-1', projectId: 'proj-1' });
    expect(session.tools).toEqual([]);
    expect(session.instructions).toBeUndefined();
  });

  it('keeps only the names configure() listed and appends its instructions', async () => {
    const session = await resolvePluginSessionTools([
      source({
        pluginId: 'salesforce',
        tools: [tool('sf_soql'), tool('sf_apex'), tool('sf_hidden')],
        extraInstructions: ['Always confirm writes.'],
        configurers: [() => ({
          tools: ['sf_soql', 'sf_apex'],
          instructions: 'Use Salesforce tools.'
        })]
      })
    ], { threadId: 'thr-1', projectId: 'proj-1' });
    expect(session.tools.map((row) => row.name)).toEqual(['sf_soql', 'sf_apex']);
    expect(session.instructions).toBe('Always confirm writes.\n\nUse Salesforce tools.');
  });

  it('drops a plugin that throws from configure() without blocking later plugins', async () => {
    const session = await resolvePluginSessionTools([
      source({
        pluginId: 'broken',
        tools: [tool('boom')],
        configurers: [() => {
          throw new Error('configure failed');
        }]
      }),
      source({
        pluginId: 'ok',
        tools: [tool('echo')]
      })
    ], { threadId: 'thr-1', projectId: 'proj-1' });
    expect(session.tools.map((row) => row.name)).toEqual(['echo']);
  });

  it('keeps the first plugin when two register the same tool name', async () => {
    const session = await resolvePluginSessionTools([
      source({ pluginId: 'a', tools: [tool('shared')] }),
      source({ pluginId: 'b', tools: [tool('shared')] })
    ], { threadId: 'thr-1', projectId: 'proj-1' });
    expect(session.tools).toHaveLength(1);
    expect(session.tools[0]?.description).toBe('shared tool');
  });

  it('treats configure() tools: [] as no tools from that plugin', async () => {
    const session = await resolvePluginSessionTools([
      source({
        pluginId: 'gated',
        tools: [tool('hidden')],
        configurers: [() => ({ tools: [] })]
      })
    ], { threadId: 'thr-1', projectId: 'proj-1' });
    expect(session.tools).toEqual([]);
  });
});

describe('invokePluginAgentTool', () => {
  it('stringifies a successful object result', async () => {
    const result = await invokePluginAgentTool(
      [source({ pluginId: 'sf', tools: [tool('sf_soql', async (input) => ({ ok: true, input }))] })],
      'sf_soql',
      { query: 'SELECT Id FROM Account' },
      { threadId: 'thr-1', projectId: 'proj-1', signal: new AbortController().signal }
    );
    expect(result.success).toBe(true);
    expect(result.contentItems).toEqual([{
      type: 'inputText',
      text: JSON.stringify({ ok: true, input: { query: 'SELECT Id FROM Account' } })
    }]);
  });

  it('marks { ok: false } results as unsuccessful', async () => {
    const result = await invokePluginAgentTool(
      [source({ pluginId: 'sf', tools: [tool('sf_apex', async () => ({ ok: false, error: 'timeout' }))] })],
      'sf_apex',
      {},
      { threadId: 'thr-1', projectId: 'proj-1', signal: new AbortController().signal }
    );
    expect(result.success).toBe(false);
    expect(result.contentItems[0]).toMatchObject({ type: 'inputText', text: expect.stringContaining('timeout') });
  });

  it('returns a string result as-is', async () => {
    const result = await invokePluginAgentTool(
      [source({ pluginId: 'notes', tools: [tool('echo', async () => 'pong')] })],
      'echo',
      {},
      { threadId: 'thr-1', projectId: 'proj-1', signal: new AbortController().signal }
    );
    expect(result).toEqual({
      success: true,
      contentItems: [{ type: 'inputText', text: 'pong' }]
    });
  });

  it('catches execute() throws', async () => {
    const result = await invokePluginAgentTool(
      [source({
        pluginId: 'sf',
        tools: [tool('sf_lwc', async () => {
          throw new Error('no org');
        })]
      })],
      'sf_lwc',
      {},
      { threadId: 'thr-1', projectId: 'proj-1', signal: new AbortController().signal }
    );
    expect(result.success).toBe(false);
    expect(result.contentItems[0]?.text).toMatch(/no org/);
  });

  it('reports unsupported tools', async () => {
    const result = await invokePluginAgentTool(
      [source({ pluginId: 'sf', tools: [tool('sf_soql')] })],
      'sf_missing',
      {},
      { threadId: 'thr-1', projectId: 'proj-1', signal: new AbortController().signal }
    );
    expect(result).toEqual({
      success: false,
      contentItems: [{ type: 'inputText', text: 'Unsupported tool: sf_missing' }]
    });
  });

  it('stringifies circular results without throwing', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const result = await invokePluginAgentTool(
      [source({ pluginId: 'x', tools: [tool('circ', async () => circular)] })],
      'circ',
      {},
      { threadId: 'thr-1', projectId: 'proj-1', signal: new AbortController().signal }
    );
    expect(result.success).toBe(true);
    expect(result.contentItems[0]?.text).toBe('[object Object]');
  });
});

describe('packHostSessionTooling', () => {
  it('omits empty sessions', () => {
    expect(packHostSessionTooling(undefined)).toEqual({});
    expect(packHostSessionTooling({ tools: [] })).toEqual({});
  });

  it('caps tools and instructions', () => {
    const packed = packHostSessionTooling({
      tools: Array.from({ length: HOST_SESSION_TOOLS_MAX + 3 }, (_, index) => ({
        name: `t${index}`,
        description: 'd',
        inputSchema: {}
      })),
      instructions: `${'x'.repeat(HOST_SESSION_INSTRUCTIONS_MAX)}extra`
    });
    expect(packed.dynamicTools).toHaveLength(HOST_SESSION_TOOLS_MAX);
    expect(packed.instructions).toHaveLength(HOST_SESSION_INSTRUCTIONS_MAX);
  });
});

describe('safePackPluginSession', () => {
  it('returns an empty object when loading throws', async () => {
    await expect(safePackPluginSession(async () => {
      throw new Error('down');
    })).resolves.toEqual({});
  });

  it('packs a successful session', async () => {
    await expect(safePackPluginSession(async () => ({
      tools: [{ name: 'sf_soql', description: 'SOQL', inputSchema: { type: 'object' } }],
      instructions: 'Use sf_soql.'
    }))).resolves.toEqual({
      dynamicTools: [{ name: 'sf_soql', description: 'SOQL', inputSchema: { type: 'object' } }],
      instructions: 'Use sf_soql.'
    });
  });
});
