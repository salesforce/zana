import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BUILTIN_PLUGINS,
  OFFICIAL_PLUGINS,
  RETIRED_FIRST_PARTY_PLUGIN_IDS,
  isRetiredFirstPartyPluginId
} from './builtin-registry.js';

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

describe('builtin plugin packages', () => {
  it('autoInstall builtins have a package.json under plugins/<name>', () => {
    const pluginsRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../plugins');
    for (const def of BUILTIN_PLUGINS) {
      if (!def.autoInstall) continue;
      expect(
        existsSync(join(pluginsRoot, def.name, 'package.json')),
        `missing plugins/${def.name}/package.json`
      ).toBe(true);
    }
  });
});
