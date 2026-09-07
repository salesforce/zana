import { AGENT_SCRIPT_DIALECTS, type AgentScriptDialect } from './types.js';

export const PLAYGROUND_VIEWS = ['script', 'split', 'graph'] as const;
export type PlaygroundView = (typeof PLAYGROUND_VIEWS)[number];
export const DEFAULT_PLAYGROUND_VIEW: PlaygroundView = 'script';

const DIALECT_LABEL: Record<AgentScriptDialect, string> = {
  agentforce: 'Agentforce',
  agentscript: 'Agent Script',
  agentfabric: 'Agentfabric'
};

const VIEW_LABEL: Record<PlaygroundView, string> = {
  script: 'Script',
  split: 'Split',
  graph: 'Graph'
};

export function dialectLabel(id: AgentScriptDialect): string {
  return DIALECT_LABEL[id] ?? id;
}

export function playgroundViewLabel(view: PlaygroundView): string {
  return VIEW_LABEL[view];
}

export function normalizePlaygroundView(value: unknown): PlaygroundView {
  return PLAYGROUND_VIEWS.includes(value as PlaygroundView)
    ? (value as PlaygroundView)
    : DEFAULT_PLAYGROUND_VIEW;
}

export function dialectOptions(): Array<{ id: AgentScriptDialect; label: string }> {
  return AGENT_SCRIPT_DIALECTS.map((id) => ({ id, label: dialectLabel(id) }));
}
