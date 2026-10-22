import { AGENT_SCRIPT_TOOLS, type AgentScriptTool } from './AgentScriptTools.js';

/** The thread side panel bound to one agent (File / Preview / Tests / Graph / Actions / Comments). */
export const AGENTFORCE_AGENT_ACTION = 'agent';
export const AGENTFORCE_PREVIEW_ACTION = 'preview';

/** Extra thread-panel params from chat cards and guardrail rows: a file, a line, a tool tab, a dependency. */
/** `nonce` makes a repeated open of the same place move the editor again. */
/** `simulation` is a Simulation lab batch id: the Tests tool opens on that batch. */
export interface StudioFocus { path?: string; line?: number; apiName?: string; tool?: AgentScriptTool; readOnly?: boolean; simulation?: string; nonce?: number }

const API_NAME = /^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)?$/;
const BATCH_ID = /^[A-Za-z0-9-]{1,64}$/;

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
  if (typeof raw.simulation === 'string' && BATCH_ID.test(raw.simulation)) focus.simulation = raw.simulation;
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
export const focusKey = (focus: StudioFocus) => JSON.stringify([focus.path ?? '', focus.line ?? 0, focus.apiName ?? '', focus.tool ?? '', focus.readOnly ?? false, focus.simulation ?? '', focus.nonce ?? 0]);

export const parseAgentforcePanelPath = (params: unknown): string | undefined => parseAgentforcePanelFocus(params).path;
export const parseAgentforcePanelApiName = (params: unknown): string | undefined => parseAgentforcePanelFocus(params).apiName;

/** Serialises focus into string thread-panel params (the inverse of parseAgentforcePanelFocus). */
export function agentforcePanelParams(path?: string, apiName?: string, extra: Pick<StudioFocus, 'line' | 'tool' | 'readOnly' | 'simulation'> = {}): Record<string, string> {
  const next: Record<string, string> = {};
  if (path?.trim()) next.path = path.trim();
  if (apiName?.trim()) next.apiName = apiName.trim();
  if (extra.line && extra.line >= 1) next.line = String(Math.floor(extra.line));
  if (extra.tool) next.tool = extra.tool;
  if (extra.readOnly) next.readOnly = 'true';
  if (extra.simulation) next.simulation = extra.simulation;
  return next;
}

export const AGENTFORCE_AGENT_VIEWS = ['file', 'preview', 'tests', 'graph', 'actions', 'comments'] as const;
export type AgentforceAgentView = typeof AGENTFORCE_AGENT_VIEWS[number];

/** Params of the thread `agent` panel (all strings across the host boundary); `path` is required. */
export interface AgentforceAgentParams { path: string; view: AgentforceAgentView; line?: number; runId?: string; turn?: number; node?: string; projectId?: string; sub?: string; batchId?: string }

const AGENT_PATH = /\.(agent|afscript)$/i;
/** A project-relative `.agent`/`.afscript` path without traversal; the server re-validates. */
export function isAgentPanelPath(path: unknown): path is string {
  return typeof path === 'string' && path.length > 0 && path.length <= 500 && AGENT_PATH.test(path) && !path.includes('\0') && !path.split(/[\\/]/).includes('..');
}

const positiveInt = (value: unknown, digits: number): number | undefined => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && new RegExp(`^\\d{1,${digits}}$`).test(value.trim()) ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 ? n : undefined;
};
const shortText = (value: unknown, max: number): string | undefined => typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : undefined;

/** Serialises agent-panel params; null when the path is not an agent file. */
export function agentforceAgentParams(input: Partial<AgentforceAgentParams> & { path: string }): Record<string, string> | null {
  if (!isAgentPanelPath(input.path)) return null;
  const next: Record<string, string> = { path: input.path, view: AGENTFORCE_AGENT_VIEWS.includes(input.view as AgentforceAgentView) ? input.view! : 'file' };
  const line = positiveInt(input.line, 7);
  if (line) next.line = String(line);
  const runId = shortText(input.runId, 256);
  if (runId) next.runId = runId;
  const turn = positiveInt(input.turn, 4);
  if (turn) next.turn = String(turn);
  const node = shortText(input.node, 200);
  if (node) next.node = node;
  const projectId = shortText(input.projectId, 200);
  if (projectId) next.projectId = projectId;
  const sub = shortText(input.sub, 32);
  if (sub) next.sub = sub;
  if (typeof input.batchId === 'string' && BATCH_ID.test(input.batchId)) next.batchId = input.batchId;
  return next;
}

/** The inverse of agentforceAgentParams; null without a valid agent path. An unknown view reads as `file`. */
export function parseAgentforceAgentParams(params: unknown): AgentforceAgentParams | null {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return null;
  const raw = params as Record<string, unknown>;
  const path = typeof raw.path === 'string' ? raw.path.trim() : '';
  if (!isAgentPanelPath(path)) return null;
  const out: AgentforceAgentParams = { path, view: AGENTFORCE_AGENT_VIEWS.find(view => view === raw.view) ?? 'file' };
  const line = positiveInt(raw.line, 7);
  if (line) out.line = line;
  const runId = shortText(raw.runId, 256);
  if (runId) out.runId = runId;
  const turn = positiveInt(raw.turn, 4);
  if (turn) out.turn = turn;
  const node = shortText(raw.node, 200);
  if (node) out.node = node;
  const projectId = shortText(raw.projectId, 200);
  if (projectId) out.projectId = projectId;
  const sub = shortText(raw.sub, 32);
  if (sub) out.sub = sub;
  if (typeof raw.batchId === 'string' && BATCH_ID.test(raw.batchId)) out.batchId = raw.batchId;
  return out;
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
