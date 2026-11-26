import { describe, expect, it } from 'vitest';
import { attributedPromptInput, MAX_AGENT_CONTEXT_LENGTH, parsePluginMessageAttribution } from './plugin-message-source.js';

describe('parsePluginMessageAttribution', () => {
  it('returns nothing when no attribution is given', () => {
    expect(parsePluginMessageAttribution('bots', undefined)).toEqual({});
    expect(parsePluginMessageAttribution('bots', {})).toEqual({});
  });

  it('stamps the calling plugin over any claimed pluginId and trims display fields', () => {
    expect(parsePluginMessageAttribution('bots', {
      agentContext: ' [Reply from bot Scout] ',
      source: { kind: 'bot', label: ' Scout ', color: '#A855F7', threadId: 't1', detail: 'replied', pluginId: 'other' }
    })).toEqual({
      agentContext: '[Reply from bot Scout]',
      messageSource: { pluginId: 'bots', kind: 'bot', label: 'Scout', color: '#A855F7', threadId: 't1', detail: 'replied' }
    });
  });

  it.each([
    [{ source: 'Scout' }, 'source must be an object'],
    [{ source: [] }, 'source must be an object'],
    [{ source: { kind: 'bot' } }, 'source.label must be a non-empty string'],
    [{ source: { kind: 'bot', label: '  ' } }, 'source.label must be a non-empty string'],
    [{ source: { kind: 'bot', label: 'Sc\nout' } }, 'single line'],
    [{ source: { kind: 'bot', label: 'You\u202e' } }, 'single line'],
    [{ source: { kind: 'bot', label: 'Scout', detail: 3 } }, 'source.detail must be a non-empty string'],
    [{ source: { kind: 'admin', label: 'Scout' } }, 'source.kind is invalid'],
    [{ source: { kind: 'bot', label: 'Scout', color: 'red' } }, 'source.color is invalid'],
    [{ source: { kind: 'bot', label: 'x'.repeat(81) } }, 'source.label is invalid'],
    [{ agentContext: '' }, 'agentContext must be a non-empty string'],
    [{ agentContext: 7 }, 'agentContext must be a non-empty string'],
    [{ agentContext: 'x'.repeat(MAX_AGENT_CONTEXT_LENGTH + 1) }, 'at most']
  ])('rejects %j', (args, message) => {
    expect(() => parsePluginMessageAttribution('bots', args as never)).toThrow(message);
  });
});

describe('attributedPromptInput', () => {
  it('puts the agent header in an agent-only part ahead of the visible body', () => {
    expect(attributedPromptInput('green', { agentContext: '[Reply from bot Scout]' })).toEqual([
      { type: 'text', text: '[Reply from bot Scout]', mentions: [], visibility: 'agent-only' },
      { type: 'text', text: 'green', mentions: [] }
    ]);
  });

  it('keeps a plain body (and its visibility) without a header', () => {
    expect(attributedPromptInput('hi', {})).toEqual([{ type: 'text', text: 'hi', mentions: [] }]);
    expect(attributedPromptInput('hi', {}, 'agent-only')).toEqual([{ type: 'text', text: 'hi', mentions: [], visibility: 'agent-only' }]);
    expect(attributedPromptInput('hi', {}, 'hidden')).toEqual([{ type: 'text', text: 'hi', mentions: [], visibility: 'hidden' }]);
  });
});
