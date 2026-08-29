import type { AgentScriptDialect } from './types.js';

export type AgentGraphNodeKind = 'start' | 'topic' | 'action';

export interface AgentGraphNode {
  id: string;
  kind: AgentGraphNodeKind;
  label: string;
}

export interface AgentGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface AgentScriptDiagnostic {
  message: string;
  severity: 'error' | 'warning' | 'info' | 'hint';
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  code?: string;
}

export interface AgentScriptParseResult {
  dialect: AgentScriptDialect;
  hasErrors: boolean;
  diagnostics: AgentScriptDiagnostic[];
  graph: { nodes: AgentGraphNode[]; edges: AgentGraphEdge[] };
}

export interface AgentScriptExample {
  id: string;
  title: string;
  dialect: AgentScriptDialect;
  source: string;
}

const TOPIC_HEADER = /^(?:[ \t]*)topic[ \t]+([A-Za-z_][\w]*)/gm;
const START_HEADER = /^(?:[ \t]*)start_agent\b/gm;
const TRANSITION = /transition[ \t]+to[ \t]+@(topic|subagent|actions)\.([A-Za-z_][\w]*)/g;
const RUN_ACTION = /run[ \t]+@actions\.([A-Za-z_][\w]*)/g;

export function isAgentScriptFile(path: string): boolean {
  return /\.(agent|afscript)$/i.test(path);
}

export function graphFromAgentSource(source: string): { nodes: AgentGraphNode[]; edges: AgentGraphEdge[] } {
  const nodes = new Map<string, AgentGraphNode>();
  const edges: AgentGraphEdge[] = [];
  const addNode = (id: string, kind: AgentGraphNodeKind, label: string) => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, label });
  };

  addNode('start', 'start', 'start_agent');
  START_HEADER.lastIndex = 0;
  if (!START_HEADER.test(source)) {
    nodes.delete('start');
  }

  TOPIC_HEADER.lastIndex = 0;
  for (const match of source.matchAll(TOPIC_HEADER)) {
    const name = match[1]!;
    addNode(`topic:${name}`, 'topic', name);
  }

  TRANSITION.lastIndex = 0;
  let from = nodes.has('start') ? 'start' : null;
  for (const match of source.matchAll(TRANSITION)) {
    const kind = match[1]!;
    const name = match[2]!;
    const target = kind === 'actions' ? `action:${name}` : `topic:${name}`;
    addNode(target, kind === 'actions' ? 'action' : 'topic', name);
    const sourceId = from ?? target;
    edges.push({
      id: `${sourceId}->${target}:${edges.length}`,
      source: sourceId,
      target,
      label: kind === 'actions' ? 'run' : 'transition'
    });
    if (kind !== 'actions') from = target;
  }

  RUN_ACTION.lastIndex = 0;
  for (const match of source.matchAll(RUN_ACTION)) {
    const name = match[1]!;
    const target = `action:${name}`;
    addNode(target, 'action', name);
    const sourceId = from ?? (nodes.has('start') ? 'start' : target);
    edges.push({
      id: `${sourceId}->${target}:${edges.length}`,
      source: sourceId,
      target,
      label: 'run'
    });
  }

  if (nodes.size === 0) {
    addNode('empty', 'start', 'empty');
  }
  return { nodes: [...nodes.values()], edges };
}

export const AGENT_SCRIPT_EXAMPLES: readonly AgentScriptExample[] = [
  {
    id: 'support-bot',
    title: 'Support bot',
    dialect: 'agentforce',
    source: `# @dialect:agentforce
config:
    agent_name: "Support Bot"
    default_locale: "en_US"

variables:
    case_id: mutable string = ""
        description: "The current support case ID"
    is_verified: mutable boolean = False

system:
    instructions: |
        You are a helpful support agent.
        Always verify the customer before discussing account details.

start_agent:
    reasoning:
        instructions: ->
            | Greet the user and ask for their case ID.
            if @variables.is_verified:
                | You may discuss account details.
            | Always be concise and professional.
    after_reasoning:
        if not @variables.is_verified:
            transition to @topic.identity_verification
        else:
            transition to @topic.billing

topic identity_verification:
    description: "Verify the customer before account work"
    reasoning:
        instructions: ->
            | Ask for the email on the account, then confirm the case ID.

topic billing:
    description: "Handle billing inquiries"
    reasoning:
        instructions: ->
            | Look up the case and explain the latest invoice in plain language.
`
  },
  {
    id: 'minimal',
    title: 'Minimal agent',
    dialect: 'agentscript',
    source: `# @dialect:agentscript
config:
    agent_name: "Minimal"

system:
    instructions: "You are a concise assistant."

start_agent:
    reasoning:
        instructions: "Greet the user and wait for a task."
`
  },
  {
    id: 'fabric-router',
    title: 'Fabric router',
    dialect: 'agentfabric',
    source: `# @dialect:agentfabric
config:
    agent_name: "Fabric Router"

system:
    instructions: "Route the user to the right specialist."

start_agent:
    reasoning:
        instructions: ->
            | Ask what the user needs, then transition.
    after_reasoning:
        transition to @topic.handoff

topic handoff:
    description: "Hand the conversation to a specialist"
    reasoning:
        instructions: "Summarize the request and pick a specialist."
`
  }
];
