import type { ThreadTab, ThreadTabsResponse } from '@zana-ai/zcc-server-contract';
import type { ClosableSecondaryTab, ThreadSecondaryPanelState } from './threadSecondaryPanelState.js';
import { emptySecondaryPanelState } from './threadSecondaryPanelState.js';

function lineRangeFromNumber(lineNumber?: number | null): {
  startLineNumber: number;
  endLineNumber: number;
} | null {
  if (typeof lineNumber !== 'number' || lineNumber <= 0) return null;
  const n = Math.floor(lineNumber);
  return { startLineNumber: n, endLineNumber: n };
}

function lineNumberFromRange(range: { startLineNumber: number } | null | undefined): number | undefined {
  if (!range || range.startLineNumber <= 0) return undefined;
  return range.startLineNumber;
}

export function closableTabsToContract(tabs: readonly ClosableSecondaryTab[]): ThreadTab[] {
  const mapped: ThreadTab[] = [];
  for (const tab of tabs) {
    const contract = closableTabToContract(tab);
    if (contract) mapped.push(contract);
  }
  return mapped;
}

export function closableTabToContract(tab: ClosableSecondaryTab): ThreadTab | null {
  if (tab.kind === 'explorer') return null;
  if (tab.kind === 'file-preview') {
    if (!tab.path) return null;
    return {
      id: tab.id,
      kind: 'workspace-file-preview',
      environmentId: null,
      projectId: null,
      path: tab.path,
      source: { kind: 'working-tree' },
      statusLabel: null,
      lineRange: lineRangeFromNumber(tab.lineNumber)
    };
  }
  if (tab.kind === 'storage-preview') {
    if (!tab.path) return null;
    return {
      id: tab.id,
      kind: 'thread-storage-file-preview',
      environmentId: null,
      isPinned: false,
      path: tab.path,
      threadId: null,
      lineRange: lineRangeFromNumber(tab.lineNumber)
    };
  }
  if (tab.kind === 'browser') {
    return {
      id: tab.id,
      kind: 'browser',
      environmentId: null,
      title: tab.title || null,
      url: tab.url ?? ''
    };
  }
  if (tab.kind === 'terminal') {
    if (!tab.sessionId) return null;
    return {
      id: tab.id,
      kind: 'terminal',
      terminalId: tab.sessionId
    };
  }
  if (tab.kind === 'plugin') {
    const pluginId = tab.pluginId ?? tab.moduleId;
    if (!pluginId || !tab.actionId) return null;
    let paramsJson: string | null = null;
    if (tab.params !== undefined) {
      try {
        paramsJson = JSON.stringify(tab.params);
      } catch {
        paramsJson = null;
      }
    }
    return {
      id: tab.id,
      kind: 'plugin-panel',
      pluginId,
      actionId: tab.actionId,
      title: tab.title,
      paramsJson
    };
  }
  if (tab.kind === 'new-tab') {
    return { id: tab.id, kind: 'new-tab' };
  }
  return null;
}

export function contractTabsToClosable(tabs: readonly ThreadTab[]): ClosableSecondaryTab[] {
  const mapped: ClosableSecondaryTab[] = [];
  for (const tab of tabs) {
    const closable = contractTabToClosable(tab);
    if (closable) mapped.push(closable);
  }
  return mapped;
}

export function contractTabToClosable(tab: ThreadTab): ClosableSecondaryTab | null {
  if (tab.kind === 'workspace-file-preview') {
    return {
      id: tab.id,
      kind: 'file-preview',
      title: tab.path.split(/[/\\]/).pop() || tab.path,
      path: tab.path,
      ...(lineNumberFromRange(tab.lineRange) ? { lineNumber: lineNumberFromRange(tab.lineRange) } : {})
    };
  }
  if (tab.kind === 'thread-storage-file-preview') {
    return {
      id: tab.id,
      kind: 'storage-preview',
      title: tab.path.split(/[/\\]/).pop() || tab.path,
      path: tab.path,
      ...(lineNumberFromRange(tab.lineRange) ? { lineNumber: lineNumberFromRange(tab.lineRange) } : {})
    };
  }
  if (tab.kind === 'browser') {
    return {
      id: tab.id,
      kind: 'browser',
      title: tab.title || 'Browser',
      url: tab.url
    };
  }
  if (tab.kind === 'terminal') {
    return {
      id: tab.id,
      kind: 'terminal',
      title: 'Terminal',
      sessionId: tab.terminalId
    };
  }
  if (tab.kind === 'plugin-panel') {
    let params: ClosableSecondaryTab['params'] = null;
    if (tab.paramsJson) {
      try {
        params = JSON.parse(tab.paramsJson) as ClosableSecondaryTab['params'];
      } catch {
        params = null;
      }
    }
    return {
      id: tab.id,
      kind: 'plugin',
      title: tab.title,
      pluginId: tab.pluginId,
      moduleId: tab.pluginId,
      actionId: tab.actionId,
      params
    };
  }
  if (tab.kind === 'new-tab') {
    return { id: tab.id, kind: 'new-tab', title: 'New Tab' };
  }
  return null;
}

export function applyContractTabs(
  state: ThreadSecondaryPanelState,
  tabs: readonly ThreadTab[]
): ThreadSecondaryPanelState {
  const nextTabs = contractTabsToClosable(tabs);
  const known = new Set(nextTabs.map((tab) => tab.id));
  const activeId = known.has(state.activeId)
    ? state.activeId
    : nextTabs[0]?.id ?? state.activeId;
  return {
    ...state,
    isOpen: nextTabs.length > 0 ? true : state.isOpen,
    tabs: nextTabs,
    activeId
  };
}

export function emptyPanelWithContractTabs(tabs: readonly ThreadTab[]): ThreadSecondaryPanelState {
  return applyContractTabs(emptySecondaryPanelState(), tabs);
}

export function tabsPutBody(
  state: ThreadSecondaryPanelState,
  expectedRevision: number
): { expectedRevision: number; tabs: ThreadTab[] } {
  return {
    expectedRevision,
    tabs: closableTabsToContract(state.tabs)
  };
}

export function revisionFromTabsResponse(body: ThreadTabsResponse | null | undefined): number {
  return typeof body?.revision === 'number' && body.revision >= 0 ? body.revision : 0;
}
