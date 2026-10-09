import { parse } from '@sf-agentscript/agentforce';
import { actionsFromAst } from './agent-action-model.js';
import type { AgentScriptDialect } from './types.js';
import {
  graphFromAgentSource,
  type AgentScriptDiagnostic,
  type AgentScriptParseResult
} from './agent-script-model.js';

function severityFromCode(value: number | undefined): AgentScriptDiagnostic['severity'] {
  if (value === 2) return 'warning';
  if (value === 3) return 'info';
  if (value === 4) return 'hint';
  return 'error';
}

function withDialectAnnotation(source: string, dialect: AgentScriptDialect): string {
  if (/@dialect\s*:/.test(source.slice(0, 400))) return source;
  return `# @dialect:${dialect}\n${source}`;
}

export function parseAgentScriptSource(source: string, dialect: AgentScriptDialect): AgentScriptParseResult {
  const annotated = withDialectAnnotation(source, dialect);
  const doc = parse(annotated);
  const actions = actionsFromAst(doc.ast, source, annotated === source ? 0 : 1);
  const graph = graphFromAgentSource(source);
  if (actions.length) {
    graph.nodes = graph.nodes.filter(node => node.kind !== 'action');
    graph.edges = graph.edges.filter(edge => !edge.target.startsWith('action:'));
    for (const action of actions) {
      const id = `action:${action.id}`;
      graph.nodes.push({ id, kind: 'action', label: action.name, actionId: action.id });
      const owner = action.owner.startsWith('start_agent.') ? 'start' : `topic:${action.owner.split('.')[1]}`;
      if (graph.nodes.some(node => node.id === owner)) {
        const kinds = [...new Set(action.uses.map(use => use.kind))];
        graph.edges.push({ id: `${owner}->${id}`, source: owner, target: id, label: kinds.length ? kinds.map(kind => kind === 'run' ? 'explicit run' : 'available').join(' · ') : 'declared' });
      }
    }
  }
  const diagnostics: AgentScriptDiagnostic[] = doc.diagnostics.map((row) => ({
    message: row.message,
    severity: severityFromCode(row.severity),
    line: row.range.start.line,
    column: row.range.start.character,
    endLine: row.range.end.line,
    endColumn: row.range.end.character,
    ...(typeof row.code === 'string' ? { code: row.code } : {})
  }));
  return {
    dialect,
    hasErrors: doc.hasErrors,
    diagnostics,
    actions,
    graph
  };
}

export interface AgentSourceLocations {
  /** Topic / subagent / start_agent name -> 1-based declaration line (first wins). */
  topics: Record<string, number>;
  /** Action name -> 1-based declaration line (first wins). */
  actions: Record<string, number>;
}

const LOCATION_CAP = 500;
const HEADER = /^[ \t]*(start_agent|topic|subagent)(?:[ \t]+([A-Za-z_]\w*))?[ \t]*:/;
const ACTIONS_HEADER = /^[ \t]*actions[ \t]*:[ \t]*(?:#.*)?$/;
const ACTION_DECL = /^[ \t]+([A-Za-z_]\w*)[ \t]*:[ \t]*(?:#.*)?$/;
const indentOf = (line: string) => line.length - line.trimStart().length;

/**
 * Maps topic and action names to source lines so trace steps can jump to code. Names come from a header
 * scan; the parsed AST fills in action lines the scan missed. Never throws on malformed source.
 */
export function sourceLocations(source: string, dialect: AgentScriptDialect = 'agentforce'): AgentSourceLocations {
  const topics: Record<string, number> = Object.create(null);
  const actions: Record<string, number> = Object.create(null);
  const lines = source.split(/\r?\n/);
  let actionsIndent = -1; // indent of the open `actions:` block, -1 when outside one
  let declIndent = -1; // indent of declarations inside that block
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const header = HEADER.exec(line);
    if (header) {
      const name = header[2] ?? (header[1] === 'start_agent' ? 'start_agent' : '');
      if (name && !(name in topics) && Object.keys(topics).length < LOCATION_CAP) topics[name] = i + 1;
      actionsIndent = -1;
      continue;
    }
    const indent = indentOf(line);
    if (ACTIONS_HEADER.test(line)) { actionsIndent = indent; declIndent = -1; continue; }
    if (actionsIndent < 0) continue;
    if (indent <= actionsIndent) { actionsIndent = -1; continue; }
    if (declIndent < 0) declIndent = indent;
    const decl = indent === declIndent ? ACTION_DECL.exec(line) : null;
    if (decl && !(decl[1]! in actions) && Object.keys(actions).length < LOCATION_CAP) actions[decl[1]!] = i + 1;
  }
  try {
    for (const action of parseAgentScriptSource(source, dialect).actions) {
      if (action.line > 0 && !(action.name in actions) && Object.keys(actions).length < LOCATION_CAP) actions[action.name] = action.line;
    }
  } catch { /* the header scan above is still useful on malformed source */ }
  return { topics, actions };
}
