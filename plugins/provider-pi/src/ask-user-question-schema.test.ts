import { describe, expect, it, vi } from 'vitest';
import { validateToolArguments } from '@earendil-works/pi-ai';
import { createFakePluginHost } from '@zana-ai/zcc-plugin-sdk/testing';
import { invokePluginAgentTool, toDynamicTool } from '../../../apps/server/src/plugins/plugin-agent-tools.js';
import plugin from '../../ask-user-question/server.mjs';

describe('ask_user_question through Pi argument validation', () => {
  async function setup() {
    const { zcc, harness } = createFakePluginHost({ pluginId: 'ask-user-question' });
    const requestInput = vi.spyOn(zcc.ui, 'requestInput').mockResolvedValue({ outcome: 'cancelled' });
    await plugin(zcc);
    const advertised = toDynamicTool(harness.agentTools[0]!);
    const tool = {
      name: advertised.name,
      description: advertised.description,
      parameters: advertised.inputSchema
    } as Parameters<typeof validateToolArguments>[0];
    const call = (input: Record<string, unknown>) => {
      const args = validateToolArguments(tool, { type: 'toolCall', id: 'ask', name: tool.name, arguments: input });
      // In particular, Pi must not coerce the JSON string into a one-element array.
      expect(args).toEqual(input);
      return invokePluginAgentTool([{ pluginId: 'ask-user-question', tools: harness.agentTools }], tool.name, args, {
        threadId: 'thread', projectId: 'project', signal: new AbortController().signal
      });
    };
    return { call, requestInput };
  }

  it.each([
    { questions: [{ question: 'Pick', options: [{ label: 'A' }, { label: 'B' }] }] },
    { questions: '[{"question":"Pick","options":["A","B"]}]' },
    { questions: [{ question: 'Pick', options: ['A', 'B'] }] },
    { questions: [{ question: 'Pick', options: '["A","B"]' }] }
  ])('accepts and normalizes supported input: %j', async input => {
    const { call, requestInput } = await setup();
    expect((await call(input)).success).toBe(true);
    expect(requestInput.mock.calls[0]![0].payload).toEqual({
      questions: [{ question: 'Pick', options: [{ label: 'A' }, { label: 'B' }] }]
    });
  });

  it.each([
    { questions: [] },
    { questions: '[]' },
    { questions: 'not JSON' },
    { questions: [{ question: 'Pick', options: [] }] },
    { questions: [{ question: ' ', options: [' '] }] }
  ])('returns the actionable plugin error without opening a card: %j', async input => {
    const { call, requestInput } = await setup();
    const result = await call(input);
    expect(result.success).toBe(false);
    expect(result.contentItems[0]).toMatchObject({ type: 'inputText', text: expect.stringContaining('ask_user_question needs { "questions": [') });
    expect(requestInput).not.toHaveBeenCalled();
  });
});
