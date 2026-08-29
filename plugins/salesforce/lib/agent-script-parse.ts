import { parse } from '@sf-agentscript/agentforce';
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
    graph: graphFromAgentSource(source)
  };
}
