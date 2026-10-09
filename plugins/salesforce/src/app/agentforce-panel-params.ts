import { AGENT_SCRIPT_TOOLS, type AgentScriptTool } from './AgentScriptTools.js';
import { queueAgentScriptOpen } from './agent-script-open.js';

export const AGENTFORCE_PLAYGROUND_ACTION = 'playground';
export const AGENTFORCE_PREVIEW_ACTION = 'preview';

/** Extra thread-panel params from chat cards and guardrail rows: a file, a line, a tool tab, a dependency. */
export interface StudioFocus { path?: string; line?: number; apiName?: string; tool?: AgentScriptTool; readOnly?: boolean }

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
  return focus;
}

export const parseStudioFocus = parseAgentforcePanelFocus;
export const focusKey = (focus: StudioFocus) => JSON.stringify([focus.path ?? '', focus.line ?? 0, focus.apiName ?? '', focus.tool ?? '', focus.readOnly ?? false]);

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
