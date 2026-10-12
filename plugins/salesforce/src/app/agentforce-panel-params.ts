import { AGENT_SCRIPT_TOOLS, type AgentScriptTool } from './AgentScriptTools.js';
import { queueAgentScriptOpen } from './agent-script-open.js';

export const AGENTFORCE_PLAYGROUND_ACTION = 'playground';
export const AGENTFORCE_PREVIEW_ACTION = 'preview';

/** Extra thread-panel params from chat cards and guardrail rows: a file, a line, a tool tab, a dependency. */
/** `nonce` makes a repeated open of the same place move the editor again. */
export interface StudioFocus { path?: string; line?: number; apiName?: string; tool?: AgentScriptTool; readOnly?: boolean; nonce?: number }

const API_NAME = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/;

/** Single parser for panel params (they cross the chat renderer and may be strings or numbers). */
export function parseAgentforcePanelFocus(params: unknown): StudioFocus {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return {};
  const raw = params as Record<string, unknown>;
  const focus: StudioFocus = {};
  if (typeof raw.path === 'string' && raw.path.trim() && raw.path.length <= 500) focus.path = raw.path.trim();
  const line = typeof raw.line === 'number' ? raw.line : typeof raw.line === 'string' && /^\d{1,7}$/.test(raw.line.trim()) ? Number(raw.line) : NaN;
  if (Number.isInteger(line) && line >= 1) focus.line = line;
  if (typeof raw.apiName === 'string' && API_NAME.test(raw.apiName.trim()) && raw.apiName.trim().length <= 200) focus.apiName = raw.apiName.trim();
  const tool = AGENT_SCRIPT_TOOLS.find(row => row.id === raw.tool);
  if (tool) focus.tool = tool.id;
  if (raw.readOnly === true || raw.readOnly === '1' || raw.readOnly === 'true') focus.readOnly = true;
  if (Number.isSafeInteger(raw.nonce) && Number(raw.nonce) > 0) focus.nonce = Number(raw.nonce);
  return focus;
}

export const parseStudioFocus = parseAgentforcePanelFocus;

/** A `::sf-preview{runId turn}` card opens Preview on one run; the turn is 1-based over agent replies. */
export function parseAgentforcePanelRun(params: unknown): { runId: string; turn?: number } | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  const raw = params as Record<string, unknown>;
  const runId = typeof raw.runId === 'string' ? raw.runId.trim() : '';
  if (!runId || runId.length > 256) return null;
  const turn = typeof raw.turn === 'number' ? raw.turn : typeof raw.turn === 'string' && /^\d{1,4}$/.test(raw.turn.trim()) ? Number(raw.turn) : NaN;
  return Number.isInteger(turn) && turn >= 1 ? { runId, turn } : { runId };
}
export const focusKey = (focus: StudioFocus) => JSON.stringify([focus.path ?? '', focus.line ?? 0, focus.apiName ?? '', focus.tool ?? '', focus.readOnly ?? false, focus.nonce ?? 0]);

export const parseAgentforcePanelPath = (params: unknown): string | undefined => parseAgentforcePanelFocus(params).path;
export const parseAgentforcePanelApiName = (params: unknown): string | undefined => parseAgentforcePanelFocus(params).apiName;

/** Serialises focus into string thread-panel params (the inverse of parseAgentforcePanelFocus). */
export function agentforcePanelParams(path?: string, apiName?: string, extra: Pick<StudioFocus, 'line' | 'tool' | 'readOnly'> = {}): Record<string, string> {
  const next: Record<string, string> = {};
  if (path?.trim()) next.path = path.trim();
  if (apiName?.trim()) next.apiName = apiName.trim();
  if (extra.line && extra.line >= 1) next.line = String(Math.floor(extra.line));
  if (extra.tool) next.tool = extra.tool;
  if (extra.readOnly) next.readOnly = 'true';
  return next;
}

export function openAgentforcePlayground(args: {
  openThreadPanel: (options: { actionId: string; title?: string; params?: Record<string, string> }) => boolean;
  projectId: string | null | undefined;
  path?: string;
}): boolean {
  if (args.projectId && args.path) {
    queueAgentScriptOpen(args.projectId, args.path);
  }
  return args.openThreadPanel({
    actionId: AGENTFORCE_PLAYGROUND_ACTION,
    title: 'Playground',
    params: agentforcePanelParams(args.path)
  });
}

export function openAgentforcePreview(args: {
  openThreadPanel: (options: { actionId: string; title?: string; params?: Record<string, string> }) => boolean;
  path?: string;
  apiName?: string;
}): boolean {
  return args.openThreadPanel({
    actionId: AGENTFORCE_PREVIEW_ACTION,
    title: 'Preview',
    params: agentforcePanelParams(args.path, args.apiName)
  });
}
