import { describe, expect, it } from 'vitest';
import {
  PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS,
  parsePluginAgentToolPresentation
} from './plugin-agent-tool-presentation.js';

describe('parsePluginAgentToolPresentation', () => {
  it('returns null when presentation is omitted', () => {
    expect(parsePluginAgentToolPresentation('echo', undefined)).toBeNull();
  });

  it('accepts label, icon, suppress, and tint', () => {
    expect(parsePluginAgentToolPresentation('echo', {
      label: { pending: 'Echoing', completed: 'Echoed' },
      icon: { glyph: 'Zap' },
      suppress: false,
      tint: { light: '#111', dark: '#eee' }
    })).toEqual({
      label: { pending: 'Echoing', completed: 'Echoed' },
      icon: { glyph: 'Zap' },
      suppress: false,
      tint: { light: '#111', dark: '#eee' }
    });
  });

  it('rejects oversized labels', () => {
    expect(() => parsePluginAgentToolPresentation('echo', {
      label: { pending: 'x'.repeat(PLUGIN_AGENT_STATUS_LABEL_MAX_CHARS + 1), completed: 'done' }
    })).toThrow(/at most/);
  });
});
