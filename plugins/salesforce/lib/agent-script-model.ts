import type { AgentScriptDialect } from './types.js';
import type { AgentAction } from './agent-action-model.js';

export type AgentGraphNodeKind = 'start' | 'topic' | 'action';

export interface AgentGraphNode {
  id: string;
  kind: AgentGraphNodeKind;
  label: string;
  actionId?: string;
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
  actions: AgentAction[];
  graph: { nodes: AgentGraphNode[]; edges: AgentGraphEdge[] };
}

export interface AgentScriptExample {
  id: string;
  title: string;
  dialect: AgentScriptDialect;
  source: string;
}

const TOPIC_HEADER = /^(?:[ \t]*)(?:topic|subagent)[ \t]+([A-Za-z_][\w]*)/gm;
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

  // Edges belong to the enclosing agent block, not the previous transition.
  // Two routes from the start agent are siblings, never an invented chain.
  let from: string | null = null;
  for (const line of source.split(/\r?\n/)) {
    const header = /^(start_agent|topic|subagent)(?:[ \t]+([A-Za-z_][\w]*))?[ \t]*:/.exec(line);
    if (header) from = header[1] === 'start_agent' ? 'start' : `topic:${header[2]}`;
    else if (/^[A-Za-z_]/.test(line)) from = null;
    if (!from || line.trimStart().startsWith('#')) continue;
    const addEdge = (target: string, kind: AgentGraphNodeKind, name: string, label: string) => {
      addNode(target, kind, name);
      edges.push({ id: `${from}->${target}:${edges.length}`, source: from!, target, label });
    };
    for (const match of line.matchAll(TRANSITION)) {
      const action = match[1] === 'actions';
      addEdge(`${action ? 'action' : 'topic'}:${match[2]}`, action ? 'action' : 'topic', match[2]!, action ? 'run' : 'transition');
    }
    for (const match of line.matchAll(RUN_ACTION)) addEdge(`action:${match[1]}`, 'action', match[1]!, 'run');
  }

  if (nodes.size === 0) {
    addNode('empty', 'start', 'empty');
  }
  return { nodes: [...nodes.values()], edges };
}

export const AGENT_SCRIPT_EXAMPLES: readonly AgentScriptExample[] = [
  {
    id: 'support-bot', title: 'Support concierge', dialect: 'agentforce',
    source: `# @dialect:agentforce
config:
    agent_name: "Support_Concierge"

language:
    default_locale: "en_US"

system:
    instructions: |
        You help customers with orders and returns.
        Be warm, concise, and ask one question at a time.
        Never invent customer data or claim an action was completed.

start_agent welcome:
    description: "Understand the request and guide the customer"
    reasoning:
        instructions: ->
            | Welcome the customer. Explain that you can help with orders or returns.
            | Ask what they need help with. For anything else, explain your scope.
        actions:
            orders: @utils.transition to @subagent.orders
                description: "Help with an order or delivery question"
            returns: @utils.transition to @subagent.returns
                description: "Help the customer understand how to request a return"

subagent orders:
    description: "Gather the details needed to track an order"
    reasoning:
        instructions: ->
            | Ask for the order number. If it is missing, ask for it politely.
            | Explain that an order lookup action must be connected to retrieve status.
            | Do not make up a delivery date.

subagent returns:
    description: "Guide a customer through a return request"
    reasoning:
        instructions: ->
            | Ask for the order number and the reason for the return.
            | Summarize the request and explain that a support representative will review it.
            | Do not promise eligibility, a refund, or a completed return.
`
  },
  {
    id: 'minimal', title: 'Hello world', dialect: 'agentforce',
    source: `# @dialect:agentforce
config:
    agent_name: "Hello_World"

system:
    instructions: "You are a friendly, concise assistant."

start_agent hello:
    description: "Welcome the user and learn what they need"
    reasoning:
        instructions: ->
            | Greet the user. Ask how you can help, then listen.
`
  },
  {
    id: 'fabric-router', title: 'Support handoff', dialect: 'agentforce',
    source: `# @dialect:agentforce
config:
    agent_name: "Support_Handoff"

system:
    instructions: "Help customers explain an issue clearly. Never claim a human has joined."

start_agent intake:
    description: "Collect the customer request"
    reasoning:
        instructions: ->
            | Ask the customer to describe the issue and what they have already tried.
        actions:
            handoff: @utils.transition to @subagent.handoff
                description: "Prepare a summary when the customer needs a human"

subagent handoff:
    description: "Prepare a useful handoff summary"
    reasoning:
        instructions: ->
            | Summarize the issue, steps tried, and desired outcome.
            | Ask the customer to confirm the summary before they contact support.
`
  }
];
