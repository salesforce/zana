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
