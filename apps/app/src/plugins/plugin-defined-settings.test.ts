import { describe, expect, it } from 'vitest';
import {
  initialPluginSettingDraft,
  isMultilinePluginSetting,
  multilineSettingRows,
  parsePluginSettingDraft,
  pluginSettingControlPlacement,
  pluginSettingSavesOnChange,
  shouldSkipPluginSettingSave,
  type PluginSettingDescriptor
} from './plugin-defined-settings.js';

const agents: PluginSettingDescriptor = {
  type: 'string',
  multiline: true,
  label: 'Custom ACP agents',
  description: 'JSON array of agents.'
};

const token: PluginSettingDescriptor = {
  type: 'string',
  secret: true,
  label: 'Token'
};

describe('plugin defined settings', () => {
  it('places a multiline JSON setting below its label', () => {
    expect(isMultilinePluginSetting(agents)).toBe(true);
    expect(pluginSettingControlPlacement(agents)).toBe('below');
    expect(pluginSettingSavesOnChange(agents)).toBe(false);
    expect(initialPluginSettingDraft(agents, '[]')).toBe('[]');
    expect(multilineSettingRows('[]')).toBe(6);
    expect(multilineSettingRows('[\n  {}\n]')).toBe(6);
  });

  it('grows multiline rows with the draft and caps them', () => {
    expect(multilineSettingRows('a')).toBe(6);
    expect(multilineSettingRows(Array.from({ length: 8 }, () => 'x').join('\n'))).toBe(9);
    expect(multilineSettingRows(Array.from({ length: 40 }, () => 'x').join('\n'))).toBe(24);
  });

  it('keeps compact settings inline and saves them on change', () => {
    expect(pluginSettingControlPlacement({ type: 'boolean', label: 'On' })).toBe('inline');
    expect(pluginSettingSavesOnChange({ type: 'boolean', label: 'On' })).toBe(true);
    expect(pluginSettingSavesOnChange({ type: 'select', label: 'Mode', options: ['a'] })).toBe(true);
    expect(pluginSettingControlPlacement(token)).toBe('inline');
    expect(initialPluginSettingDraft(token, 'secret')).toBe('');
  });

  it('does not flush an unchanged multiline draft or an empty secret', () => {
    expect(shouldSkipPluginSettingSave(agents, '[]', '[]')).toBe(true);
    expect(shouldSkipPluginSettingSave(token, '', 'secret')).toBe(true);
    expect(shouldSkipPluginSettingSave(agents, '[{}]', '[]')).toBe(false);
  });

  it('parses number drafts and rejects non-finite input', () => {
    const retries: PluginSettingDescriptor = { type: 'number', label: 'Retries' };
    expect(parsePluginSettingDraft(retries, '4.5')).toBe(4.5);
    expect(parsePluginSettingDraft(retries, '')).toBeUndefined();
    expect(shouldSkipPluginSettingSave(retries, '3', 3)).toBe(true);
    expect(() => parsePluginSettingDraft(retries, 'nope')).toThrow(/finite number/);
  });
});
