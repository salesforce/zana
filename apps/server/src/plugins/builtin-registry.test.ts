import { describe, expect, it } from 'vitest';
import { OFFICIAL_PLUGINS, RETIRED_FIRST_PARTY_PLUGIN_IDS, isRetiredFirstPartyPluginId } from './builtin-registry.js';

describe('retired first-party plugins', () => {
  it('names the leftover hub rows and never overlaps the official catalog', () => {
    expect([...RETIRED_FIRST_PARTY_PLUGIN_IDS].sort()).toEqual(['consensus', 'slack', 'zana', 'zana-hub']);
    const official = new Set(OFFICIAL_PLUGINS.map((plugin) => plugin.pluginId));
    for (const id of RETIRED_FIRST_PARTY_PLUGIN_IDS) {
      expect(official.has(id)).toBe(false);
      expect(isRetiredFirstPartyPluginId(id)).toBe(true);
    }
    expect(isRetiredFirstPartyPluginId('docs')).toBe(false);
    expect(isRetiredFirstPartyPluginId('salesforce')).toBe(false);
  });
});
