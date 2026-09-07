import { describe, expect, it } from 'vitest';
import {
  ancestorFolderPaths,
  breadcrumbSegments,
  buildAgentScriptFileTree,
  defaultExpandedFolders,
  filterAgentScriptFileTree
} from '../lib/agent-script-file-tree.js';

const files = [
  { apiName: 'QC', path: 'force-app/main/default/bots/QC.agent', lines: 12 },
  { apiName: 'Support', path: 'force-app/main/default/bots/Support.agent', lines: 8 },
  { apiName: 'RootBot', path: 'RootBot.agent', lines: 3 }
];

describe('agent script file tree', () => {
  it('nests project files under folders and keeps root files', () => {
    const tree = buildAgentScriptFileTree(files);
    expect(tree.map((node) => node.name)).toEqual(['force-app', 'RootBot.agent']);
    const forceApp = tree[0];
    expect(forceApp?.kind).toBe('folder');
    if (forceApp?.kind !== 'folder') return;
    expect(forceApp.children[0]?.name).toBe('main');
  });

  it('lists ancestor folders and breadcrumb segments', () => {
    expect(ancestorFolderPaths('force-app/bots/QC.agent')).toEqual(['force-app', 'force-app/bots']);
    expect(breadcrumbSegments('force-app/bots/QC.agent')).toEqual(['force-app', 'bots', 'QC.agent']);
    expect(breadcrumbSegments(null, 'Support bot')).toEqual(['Support bot']);
  });

  it('filters to matching files and keeps parent folders', () => {
    const tree = buildAgentScriptFileTree(files);
    const filtered = filterAgentScriptFileTree(tree, 'qc');
    expect(JSON.stringify(filtered)).toContain('QC.agent');
    expect(JSON.stringify(filtered)).not.toContain('Support.agent');
    expect(JSON.stringify(filtered)).not.toContain('RootBot.agent');
  });

  it('expands shallow folders plus the active file ancestors', () => {
    const expanded = defaultExpandedFolders(files, 'force-app/main/default/bots/QC.agent');
    expect(expanded).toEqual(
      expect.arrayContaining(['force-app', 'force-app/main', 'force-app/main/default', 'force-app/main/default/bots'])
    );
  });
});
