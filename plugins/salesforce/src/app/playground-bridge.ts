import type { AgentScriptDialect } from '../../lib/types.js';
import type { AgentScriptExample } from '../../lib/agent-script-model.js';

export const PLAYGROUND_BRIDGE_SOURCE = 'zcc-salesforce-agentscript';

export interface PlaygroundFileRef {
  apiName: string;
  path: string;
  lines: number;
}

export type PlaygroundToHost =
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'ready' }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'dirty'; dirty: boolean }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'requestOpen'; path: string }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'persist'; path: string; content: string };

export type HostToPlayground =
  | {
      source: typeof PLAYGROUND_BRIDGE_SOURCE;
      type: 'init';
      dialect: AgentScriptDialect;
      theme: 'light' | 'dark';
      examples: readonly AgentScriptExample[];
      files: PlaygroundFileRef[];
      saveEnabled: boolean;
    }
  | {
      source: typeof PLAYGROUND_BRIDGE_SOURCE;
      type: 'setFile';
      path: string | null;
      content: string;
      dialect: AgentScriptDialect;
      readOnly: boolean;
      sha256?: string;
    }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setTheme'; theme: 'light' | 'dark' }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setDialect'; dialect: AgentScriptDialect }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'setFiles'; files: PlaygroundFileRef[] }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'saved'; sha256: string }
  | { source: typeof PLAYGROUND_BRIDGE_SOURCE; type: 'flushSave' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

export function isPlaygroundToHost(value: unknown): value is PlaygroundToHost {
  if (!isRecord(value) || value.source !== PLAYGROUND_BRIDGE_SOURCE || typeof value.type !== 'string') {
    return false;
  }
  if (value.type === 'ready') return true;
  if (value.type === 'dirty') return typeof value.dirty === 'boolean';
  if (value.type === 'requestOpen') return typeof value.path === 'string';
  return value.type === 'persist' && typeof value.path === 'string' && typeof value.content === 'string';
}

export function isHostToPlayground(value: unknown): value is HostToPlayground {
  if (!isRecord(value) || value.source !== PLAYGROUND_BRIDGE_SOURCE || typeof value.type !== 'string') {
    return false;
  }
  return (
    value.type === 'init' ||
    value.type === 'setFile' ||
    value.type === 'setTheme' ||
    value.type === 'setDialect' ||
    value.type === 'setFiles' ||
    value.type === 'saved' ||
    value.type === 'flushSave'
  );
}

export function readDocumentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'dark';
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export const PLAYGROUND_ASSET_SRC = '/plugins/salesforce/assets/playground/dist/index.html';
