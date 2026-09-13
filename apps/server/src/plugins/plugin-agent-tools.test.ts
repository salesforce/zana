import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jsonSchemaAgentToolRecord, normalizeRegisteredAgentTool } from '@zana-ai/zcc-plugin-sdk/internal/host-policy';
import {
  GENERIC_AGENT_TOOL_GLYPH,
  HOST_SESSION_INSTRUCTIONS_MAX,
  HOST_SESSION_TOOLS_MAX,
  invokePluginAgentTool,
  LIVE_INSTRUCTION_MAX,
  packHostSessionTooling,
  resolvePluginSessionTools,
  safePackPluginSession,
  toDynamicTool,
  type PluginAgentToolSource
} from './plugin-agent-tools.js';

function tool(
  name: string,
  execute: Parameters<typeof jsonSchemaAgentToolRecord>[0]['execute'] = async (input) => input
) {
  return jsonSchemaAgentToolRecord({
    name,
    description: `${name} tool`,
    inputSchema: { type: 'object', properties: { q: { type: 'string' } } },
    execute
  });
}

function source(partial: Partial<PluginAgentToolSource> & { pluginId: string }): PluginAgentToolSource {
  return {
    tools: [],
    ...partial
  };
}

describe('toDynamicTool', () => {
  it('fills an empty object schema and default presentation when they are omitted', () => {
    expect(toDynamicTool(jsonSchemaAgentToolRecord({
      name: 'bare',
      description: 'Bare',
      execute: async () => undefined
    }))).toEqual({
      name: 'bare',
      description: 'Bare',
      inputSchema: { type: 'object', properties: {} },
      presentation: {
        label: { pending: 'Running bare', completed: 'Ran bare' },
        icon: { glyph: GENERIC_AGENT_TOOL_GLYPH }
      }
    });
  });
});

describe('resolvePluginSessionTools', () => {
  it('attributes per-tool instructions into the session prompt', async () => {
    const record = jsonSchemaAgentToolRecord({
      name: 'note_search',
      description: 'Search',
      instructions: 'Prefer exact titles.',
      execute: async () => 'ok'
    });
    const session = await resolvePluginSessionTools([
      source({ pluginId: 'notes', tools: [record] })
    ], { threadId: 'thr-1', projectId: 'proj-1' });
    expect(session.instructions).toBe(
      'The following instructions come from the ZCC plugin "notes" for its tool "note_search":\n\nPrefer exact titles.'
    );
  });

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

  it('evaluates live instruction providers, caps them, and swallows throws', async () => {
    const session = await resolvePluginSessionTools([
      source({
        pluginId: 'tunnel',
        extraInstructionProviders: [
          (ctx) => `Tunnel for ${ctx.threadId} in ${ctx.projectId} ${'x'.repeat(5000)}`,
          () => {
            throw new Error('boom');
          },
          () => null
        ]
      })
    ], { threadId: 'thr-1', projectId: 'proj-1' });
    expect(session.instructions?.startsWith('Tunnel for thr-1 in proj-1 ')).toBe(true);
    expect(session.instructions?.length).toBe(LIVE_INSTRUCTION_MAX);
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

  it('appends per-tool instructions attributed to the plugin', async () => {
    const session = await resolvePluginSessionTools([
      source({
        pluginId: 'notes',
        tools: [jsonSchemaAgentToolRecord({
          name: 'note_search',
          description: 'Search notes',
          instructions: 'Prefer recent notes.',
          execute: async () => undefined
        })]
      })
    ], { threadId: 'thr-1', projectId: 'proj-1' });
    expect(session.instructions).toContain('ZCC plugin "notes"');
    expect(session.instructions).toContain('note_search');
    expect(session.instructions).toContain('Prefer recent notes.');
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

  it('applies per-tool parameter overrides from configure()', async () => {
    const session = await resolvePluginSessionTools([
      source({
        pluginId: 'workflows',
        tools: [tool('zcc_workflow_result')],
        configurers: [() => ({
          tools: [{
            name: 'zcc_workflow_result',
            parameters: {
              type: 'object',
              properties: { value: { type: 'string' } },
              required: ['value']
            }
          }]
        })]
      })
    ], { threadId: 'thr-worker', projectId: 'proj-1' });
    expect(session.tools).toEqual([
      expect.objectContaining({
        name: 'zcc_workflow_result',
        inputSchema: {
          type: 'object',
          properties: { value: { type: 'string' } },
          required: ['value']
        }
      })
    ]);
  });
});

describe('invokePluginAgentTool', () => {
  it('attaches screenshots as inputImage and prefers result text', async () => {
    const result = await invokePluginAgentTool(
      [source({
        pluginId: 'example',
        tools: [tool('capture_page', async () => ({
          ok: true,
          output: 'title',
          result: '"ok"',
          text: 'title\n\n1 screenshot(s) attached.',
          screenshots: [{ mime: 'image/png', base64: 'aaaa' }]
        }))]
      })],
      'capture_page',
      {},
      { threadId: 'thr-1', projectId: 'proj-1', signal: new AbortController().signal }
    );
    expect(result.success).toBe(true);
    expect(result.contentItems).toEqual([
      { type: 'inputText', text: 'title\n\n1 screenshot(s) attached.' },
      { type: 'inputImage', imageUrl: 'data:image/png;base64,aaaa' }
    ]);
  });

  it('maps MCP image content parts to inputImage', async () => {
    const result = await invokePluginAgentTool(
      [source({
        pluginId: 'example',
        tools: [tool('capture_page', async () => ({
          content: [
            { type: 'text', text: 'ok' },
            { type: 'image', mimeType: 'image/jpeg', data: 'bbbb' }
          ]
        }))]
      })],
      'capture_page',
      {},
      { threadId: 'thr-1', projectId: 'proj-1', signal: new AbortController().signal }
    );
    expect(result.success).toBe(true);
    expect(result.contentItems).toEqual([
      { type: 'inputText', text: 'ok' },
      { type: 'inputImage', imageUrl: 'data:image/jpeg;base64,bbbb' }
    ]);
  });

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

  it('marks { isError: true } results as unsuccessful and joins content text', async () => {
    const result = await invokePluginAgentTool(
      [source({
        pluginId: 'workflows',
        tools: [tool('zcc_workflow_run', async () => ({
          content: [{ type: 'text', text: 'Exactly one workflow source is required' }],
          isError: true
        }))]
      })],
      'zcc_workflow_run',
      {},
      { threadId: 'thr-1', projectId: 'proj-1', signal: new AbortController().signal }
    );
    expect(result.success).toBe(false);
    expect(result.contentItems[0]?.text).toBe('Exactly one workflow source is required');
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

  it('rejects invalid arguments before execute when parameters are a zod schema', async () => {
    const record = normalizeRegisteredAgentTool({
      pluginId: 'notes',
      tool: {
        name: 'note_search',
        description: 'Search',
        parameters: z.object({ q: z.string().min(1) }),
        execute: async () => 'ok'
      }
    });
    const result = await invokePluginAgentTool(
      [source({ pluginId: 'notes', tools: [record] })],
      'note_search',
      { q: '' },
      { threadId: 'thr-1', projectId: 'proj-1', signal: new AbortController().signal }
    );
    expect(result.success).toBe(false);
    expect(result.contentItems[0]?.text).toMatch(/Invalid arguments/);
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
