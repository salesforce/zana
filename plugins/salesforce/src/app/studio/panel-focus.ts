import { AGENT_SCRIPT_TOOLS, type AgentScriptTool } from '../AgentScriptTools.js';

/** Extra thread-panel params from chat cards and guardrail rows (beyond `path`). */
export interface StudioFocus { path?: string; line?: number; apiName?: string; tool?: AgentScriptTool; readOnly?: boolean }

const API_NAME = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/;

/** Reads raw panel params defensively (they cross the chat renderer and may be strings or numbers). */
export function parseStudioFocus(params: unknown): StudioFocus {
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

export const focusKey = (focus: StudioFocus) => JSON.stringify([focus.path ?? '', focus.line ?? 0, focus.apiName ?? '', focus.tool ?? '', focus.readOnly ?? false]);
