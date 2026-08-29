import { describe, expect, it } from 'vitest';
import { enabledPluginSkillCatalog, pluginSkillCommandRows } from './plugin-skill-commands.js';

const snapshot = [
  {
    id: 'salesforce',
    name: 'Salesforce',
    enabled: true,
    skillNames: ['salesforce-dx', 'salesforce-constitution']
  },
  {
    id: 'off',
    name: 'Off',
    enabled: false,
    skillNames: ['hidden']
  },
  {
    id: 'empty',
    name: 'Empty',
    enabled: true,
    skillNames: []
  }
];

describe('enabledPluginSkillCatalog', () => {
  it('keeps enabled plugins that ship skills', () => {
    expect(enabledPluginSkillCatalog(snapshot)).toEqual([{
      pluginId: 'salesforce',
      name: 'Salesforce',
      skillNames: ['salesforce-dx', 'salesforce-constitution']
    }]);
  });
});

describe('pluginSkillCommandRows', () => {
  it('turns those skills into slash catalog rows', () => {
    expect(pluginSkillCommandRows(snapshot)).toEqual([
      {
        id: 'plugin:salesforce:salesforce-dx',
        name: '/salesforce-dx',
        description: 'Salesforce',
        pluginId: 'salesforce'
      },
      {
        id: 'plugin:salesforce:salesforce-constitution',
        name: '/salesforce-constitution',
        description: 'Salesforce',
        pluginId: 'salesforce'
      }
    ]);
  });
});
