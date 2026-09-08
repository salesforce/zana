import { describe, expect, it } from 'vitest';
import {
  applyContractTabs,
  closableTabToContract,
  contractTabToClosable
} from './threadTabsContract.js';
import { emptySecondaryPanelState } from './threadSecondaryPanelState.js';

describe('thread tabs contract mapping', () => {
  it('maps file, storage, browser, terminal, plugin, and new-tab kinds both ways', () => {
    const file = closableTabToContract({
      id: 'file-preview:1',
      kind: 'file-preview',
      title: 'a.ts',
      path: 'src/a.ts',
      lineNumber: 4
    });
    expect(file).toMatchObject({
      kind: 'workspace-file-preview',
      path: 'src/a.ts',
      source: { kind: 'working-tree' },
      lineRange: { startLineNumber: 4, endLineNumber: 4 }
    });
    expect(contractTabToClosable(file!)).toMatchObject({
      kind: 'file-preview',
      path: 'src/a.ts',
      lineNumber: 4
    });

    const storage = closableTabToContract({
      id: 'storage-preview:1',
      kind: 'storage-preview',
      title: 'notes.md',
      path: 'notes.md'
    });
    expect(storage?.kind).toBe('thread-storage-file-preview');
    expect(contractTabToClosable(storage!)?.kind).toBe('storage-preview');

    const plugin = closableTabToContract({
      id: 'plugin:1',
      kind: 'plugin',
      title: 'Board',
      pluginId: 'tasks',
      moduleId: 'tasks',
      actionId: 'board',
      params: { x: 1 }
    });
    expect(plugin).toMatchObject({
      kind: 'plugin-panel',
      pluginId: 'tasks',
      actionId: 'board',
      paramsJson: '{"x":1}'
    });
    expect(contractTabToClosable(plugin!)).toMatchObject({
      kind: 'plugin',
      actionId: 'board',
      params: { x: 1 }
    });

    expect(closableTabToContract({
      id: 'explorer:1',
      kind: 'explorer',
      title: 'Files'
    })).toBeNull();
    expect(contractTabToClosable({ id: 'info', kind: 'thread-info' })).toBeNull();
  });

  it('replaces closable tabs from a server snapshot', () => {
    const next = applyContractTabs(emptySecondaryPanelState(), [{
      id: 'file-preview:1',
      kind: 'workspace-file-preview',
      environmentId: null,
      projectId: null,
      path: 'src/a.ts',
      source: { kind: 'working-tree' },
      statusLabel: null,
      lineRange: { startLineNumber: 2, endLineNumber: 2 }
    }]);
    expect(next.isOpen).toBe(true);
    expect(next.tabs[0]).toMatchObject({ kind: 'file-preview', path: 'src/a.ts', lineNumber: 2 });
  });
});
