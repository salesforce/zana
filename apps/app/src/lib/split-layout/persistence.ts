import { MAX_PANES, countPanes, listPanes } from './ops.js';
import type { LayoutNode, PaneContent, PaneNode, SplitLayout, SplitNode } from './types.js';

export const SPLIT_LAYOUT_SCHEMA_VERSION = 1;
export const SPLIT_LAYOUT_STORAGE_KEY = 'zcc.splitLayout';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function parsePaneContent(value: unknown): PaneContent | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  if (value.kind === 'home') return { kind: 'home' };
  if (value.kind === 'agents') return { kind: 'agents' };
  if (value.kind === 'new-thread') {
    const projectId = value.projectId;
    if (projectId === undefined || projectId === null) return { kind: 'new-thread' };
    if (typeof projectId !== 'string') return null;
    return { kind: 'new-thread', projectId };
  }
  if (value.kind === 'thread') {
    if (!isNonEmptyString(value.threadId)) return null;
    if (value.projectId !== null && !isNonEmptyString(value.projectId)) return null;
    return {
      kind: 'thread',
      projectId: value.projectId === null ? null : value.projectId,
      threadId: value.threadId
    };
  }
  if (value.kind === 'plugin-detail') {
    if (!isNonEmptyString(value.pluginId)) return null;
    return { kind: 'plugin-detail', pluginId: value.pluginId };
  }
  if (value.kind === 'plugin-panel') {
    if (!isNonEmptyString(value.pluginId) || !isNonEmptyString(value.panelPath)) return null;
    if (typeof value.subPath !== 'string') return null;
    return {
      kind: 'plugin-panel',
      pluginId: value.pluginId,
      panelPath: value.panelPath,
      subPath: value.subPath
    };
  }
  return null;
}

function parsePaneNode(value: unknown): PaneNode | null {
  if (!isRecord(value) || value.type !== 'pane' || !isNonEmptyString(value.paneId)) return null;
  const content = parsePaneContent(value.content);
  if (content === null) return null;
  return { type: 'pane', paneId: value.paneId, content };
}

function parseLayoutNode(value: unknown): LayoutNode | null {
  if (!isRecord(value)) return null;
  if (value.type === 'pane') return parsePaneNode(value);
  if (value.type !== 'split') return null;
  if (value.dir !== 'row' && value.dir !== 'col') return null;
  if (!Array.isArray(value.sizes) || !Array.isArray(value.children) || value.children.length < 2) {
    return null;
  }
  if (value.sizes.length !== value.children.length) return null;
  const sizes: number[] = [];
  for (const size of value.sizes) {
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return null;
    sizes.push(size);
  }
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (Math.abs(total - 1) > 1e-9) return null;
  const children: LayoutNode[] = [];
  for (const child of value.children) {
    const parsed = parseLayoutNode(child);
    if (parsed === null) return null;
    children.push(parsed);
  }
  const split: SplitNode = { type: 'split', dir: value.dir, sizes, children };
  return split;
}

function parseSplitLayout(value: unknown): SplitLayout | null {
  if (!isRecord(value) || !isNonEmptyString(value.focusedPaneId)) return null;
  const root = parseLayoutNode(value.root);
  if (root === null) return null;
  const panes = listPanes(root);
  if (countPanes(root) > MAX_PANES) return null;
  if (!panes.some((pane) => pane.paneId === value.focusedPaneId)) return null;
  if (new Set(panes.map((pane) => pane.paneId)).size !== panes.length) return null;
  return { root, focusedPaneId: value.focusedPaneId };
}

export function serializeSplitLayout(layout: SplitLayout): string {
  return JSON.stringify({ version: SPLIT_LAYOUT_SCHEMA_VERSION, layout });
}

export function deserializeSplitLayout(storedValue: string | null): SplitLayout | null {
  if (storedValue === null) return null;
  try {
    const parsed: unknown = JSON.parse(storedValue);
    if (!isRecord(parsed) || parsed.version !== SPLIT_LAYOUT_SCHEMA_VERSION) return null;
    return parseSplitLayout(parsed.layout);
  } catch {
    return null;
  }
}
