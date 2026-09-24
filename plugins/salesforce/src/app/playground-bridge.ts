import type { PlaygroundView } from '../../lib/agent-script-chrome.js';
import type { AgentScriptDialect, PublicOrgView } from '../../lib/types.js';
import type { AgentScriptExample } from '../../lib/agent-script-model.js';
import type { AgentAction } from '../../lib/agent-action-model.js';

export const PLAYGROUND_BRIDGE_SOURCE = 'zcc-salesforce-agentscript';

export interface PlaygroundFileRef {
  apiName: string;
  path: string;
  lines: number;
}

export type PlaygroundToHost =
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'ready' }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'dirty'; dirty: boolean; draftKey?: string; baseSha?: string; persisted?: boolean }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'snapshot'; draftKey?: string; content: string; issues: number; actions?: AgentAction[] }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'openAction'; id: string }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'requestOpen'; path: string }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'persist'; path: string; content: string; draftKey?: string; create?: boolean };

export type HostToPlayground =
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'graph'; content: string; visible: boolean; theme: 'light' | 'dark' }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'revealLine'; line: number }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'reference'; content: string; language: 'apex' | 'xml' | 'json'; line?: number; theme: 'light' | 'dark' }
  | {
      source: typeof PLAYGROUND_BRIDGE_SOURCE;
      type: 'init';
      dialect: AgentScriptDialect;
      theme: 'light' | 'dark';
      examples: readonly AgentScriptExample[];
      files: PlaygroundFileRef[];
      saveEnabled: boolean;
      view?: PlaygroundView;
      org?: PublicOrgView | null;
    }
  | {
      source: typeof PLAYGROUND_BRIDGE_SOURCE;
      type: 'setFile';
      draftKey?: string;
      path: string | null;
      content: string;
      dialect: AgentScriptDialect;
      readOnly: boolean;
      sha256?: string;
    }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setTheme'; theme: 'light' | 'dark' }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setDialect'; dialect: AgentScriptDialect }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setView'; view: PlaygroundView }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setFiles'; files: PlaygroundFileRef[] }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setOrg'; org: PublicOrgView | null }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'saved'; sha256: string; draftKey?: string; content?: string }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'flushSave'; path?: string; create?: boolean };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function isPlaygroundToHost(value: unknown): value is PlaygroundToHost {
  if (!isRecord(value) || value.source !== PLAYGROUND_BRIDGE_SOURCE || typeof value.type !== 'string') {
    return false;
  }
  if (value.draftKey !== undefined && (typeof value.draftKey !== 'string' || value.draftKey.length > 2000)) return false;
  if (value.baseSha !== undefined && typeof value.baseSha !== 'string') return false;
  if (value.create !== undefined && typeof value.create !== 'boolean') return false;
  if (value.persisted !== undefined && typeof value.persisted !== 'boolean') return false;
  if (value.type === 'ready') return true;
  if (value.type === 'openAction') return typeof value.id === 'string';
  if (value.type === 'dirty') return typeof value.dirty === 'boolean';
  if (value.type === 'snapshot') return typeof value.content === 'string' && value.content.length <= 180_000 && typeof value.issues === 'number' && Number.isFinite(value.issues) && (value.actions === undefined || (Array.isArray(value.actions) && value.actions.length <= 250 && value.actions.every(isAction)));
  if (value.type === 'requestOpen') return typeof value.path === 'string';
  return value.type === 'persist' && typeof value.path === 'string' && typeof value.content === 'string';
}

function isAction(value: unknown): value is AgentAction {
  if (!isRecord(value) || !['id', 'name', 'owner', 'target', 'description'].every(key => typeof value[key] === 'string') || !Number.isInteger(value.line) || Number(value.line) < 1) return false;
  const parameter = (row: unknown) => isRecord(row) && ['name', 'type', 'description'].every(key => typeof row[key] === 'string') && typeof row.required === 'boolean';
  return Array.isArray(value.inputs) && value.inputs.length <= 250 && value.inputs.every(parameter) && Array.isArray(value.outputs) && value.outputs.length <= 250 && value.outputs.every(parameter) && Array.isArray(value.uses) && value.uses.length <= 1000 && value.uses.every(use => isRecord(use) && ['available', 'run'].includes(String(use.kind)) && Number.isInteger(use.line) && Number(use.line) > 0 && typeof use.code === 'string');
}

export function isHostToPlayground(value: unknown): value is HostToPlayground {
  if (!isRecord(value) || value.source !== PLAYGROUND_BRIDGE_SOURCE || typeof value.type !== 'string') {
    return false;
  }
  return (
    (value.type === 'graph' && typeof value.content === 'string' && value.content.length <= 180_000 && typeof value.visible === 'boolean' && ['light', 'dark'].includes(String(value.theme))) ||
    value.type === 'init' ||
    (value.type === 'revealLine' && Number.isInteger(value.line) && Number(value.line) > 0) ||
    (value.type === 'reference' && typeof value.content === 'string' && value.content.length <= 750_000 && ['apex', 'xml', 'json'].includes(String(value.language))) ||
    value.type === 'setFile' ||
    value.type === 'setTheme' ||
    value.type === 'setDialect' ||
    value.type === 'setView' ||
    value.type === 'setFiles' ||
    value.type === 'setOrg' ||
    value.type === 'saved' ||
    value.type === 'flushSave'
  );
}

export function readDocumentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export const PLAYGROUND_ASSET_SRC = '/plugins/salesforce/assets/playground/dist/index.html';
