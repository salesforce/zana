import {
  defaultDialects,
  processDocument,
  provideCompletion,
  provideDefinition,
  provideDocumentSymbols,
  provideHover,
  type DocumentState
} from '@sf-agentscript/lsp';
import { parse } from '@sf-agentscript/parser';
import { parseAgentScriptSource } from './agent-script-parse.js';
import type { AgentScriptDiagnostic } from './agent-script-model.js';
import type { AgentScriptDialect } from './types.js';

type LspDiagnostic = DocumentState['diagnostics'][number];
type LspHover = NonNullable<ReturnType<typeof provideHover>>;
type LspLocation = NonNullable<ReturnType<typeof provideDefinition>>;
type LspSymbol = ReturnType<typeof provideDocumentSymbols>[number];

export const AGENT_SCRIPT_LSP_QUERIES = ['diagnostics', 'hover', 'complete', 'definition', 'symbols'] as const;
export type AgentScriptLspQuery = (typeof AGENT_SCRIPT_LSP_QUERIES)[number];

export const LSP_DIAGNOSTIC_CAP = 40;
export const LSP_COMPLETION_CAP = 40;
export const LSP_SYMBOL_CAP = 60;

export interface AgentScriptLspPosition {
  line: number;
  column: number;
}

export interface AgentScriptLspRange {
  start: AgentScriptLspPosition;
  end: AgentScriptLspPosition;
}

export interface AgentScriptLspCompletion {
  label: string;
  kind?: number;
  detail?: string;
  insertText?: string;
}

export interface AgentScriptLspSymbol {
  name: string;
  kind: number;
  detail?: string;
  range: AgentScriptLspRange;
}

export interface AgentScriptLspResult {
  dialect: AgentScriptDialect;
  query: AgentScriptLspQuery;
  diagnostics: AgentScriptDiagnostic[];
  hasErrors: boolean;
  hover?: string;
  range?: AgentScriptLspRange;
  completions?: AgentScriptLspCompletion[];
  definition?: AgentScriptLspRange;
  symbols?: AgentScriptLspSymbol[];
}

const POSITION_QUERIES = new Set<AgentScriptLspQuery>(['hover', 'complete', 'definition']);

export function isAgentScriptLspQuery(value: unknown): value is AgentScriptLspQuery {
  return typeof value === 'string' && AGENT_SCRIPT_LSP_QUERIES.includes(value as AgentScriptLspQuery);
}

export function lspDialect(dialect: AgentScriptDialect): Exclude<AgentScriptDialect, 'agentfabric'> {
  return dialect === 'agentfabric' ? 'agentforce' : dialect;
}

function lspDialects(): typeof defaultDialects {
  const out: typeof defaultDialects = [];
  for (const dialect of defaultDialects) {
    if (!dialect?.name) continue;
    out.push(dialect);
    const short = dialect.name.includes('/') ? dialect.name.slice(dialect.name.lastIndexOf('/') + 1) : '';
    if (short && !out.some((row) => row.name === short)) {
      out.push({ ...dialect, name: short });
    }
  }
  return out;
}

function withDialectAnnotation(source: string, dialect: AgentScriptDialect): string {
  if (/@dialect\s*:/.test(source.slice(0, 400))) return source;
  return `# @dialect:${lspDialect(dialect)}\n${source}`;
}

function severityFromLsp(value: number | undefined): AgentScriptDiagnostic['severity'] {
  if (value === 2) return 'warning';
  if (value === 3) return 'info';
  if (value === 4) return 'hint';
  return 'error';
}

function mapDiagnostic(row: LspDiagnostic): AgentScriptDiagnostic {
  return {
    message: row.message,
    severity: severityFromLsp(row.severity),
    line: row.range.start.line,
    column: row.range.start.character,
    endLine: row.range.end.line,
    endColumn: row.range.end.character,
    ...(typeof row.code === 'string' || typeof row.code === 'number' ? { code: String(row.code) } : {})
  };
}

function mapRange(range: { start: { line: number; character: number }; end: { line: number; character: number } }): AgentScriptLspRange {
  return {
    start: { line: range.start.line, column: range.start.character },
    end: { line: range.end.line, column: range.end.character }
  };
}

function hoverMarkdown(hover: LspHover | null): { markdown: string; range?: AgentScriptLspRange } | null {
  if (!hover) return null;
  const contents = hover.contents;
  const markdown = Array.isArray(contents)
    ? contents
        .map((part) => (typeof part === 'string' ? part : part.value))
        .filter(Boolean)
        .join('\n\n')
    : typeof contents === 'string'
      ? contents
      : contents.value;
  if (!markdown.trim()) return null;
  return { markdown, ...(hover.range ? { range: mapRange(hover.range) } : {}) };
}

function flattenSymbols(symbols: LspSymbol[], cap: number, out: AgentScriptLspSymbol[] = []): AgentScriptLspSymbol[] {
  for (const symbol of symbols) {
    if (out.length >= cap) return out;
    out.push({
      name: symbol.name,
      kind: symbol.kind,
      ...(symbol.detail ? { detail: symbol.detail } : {}),
      range: mapRange(symbol.range)
    });
    if (symbol.children?.length) flattenSymbols(symbol.children, cap, out);
  }
  return out;
}

export function analyzeAgentScriptDocument(source: string, dialect: AgentScriptDialect, uri = 'file:///buffer.agent'): DocumentState {
  const dialects = lspDialects();
  const annotated = withDialectAnnotation(source, dialect);
  return processDocument(uri, annotated, {
    dialects,
    defaultDialect: lspDialect(dialect),
    parser: { parse },
    enableCompletionProvider: true,
    enableSemanticTokens: false
  });
}

function fallbackDiagnostics(source: string, dialect: AgentScriptDialect): Pick<AgentScriptLspResult, 'diagnostics' | 'hasErrors'> {
  const parsed = parseAgentScriptSource(source, dialect);
  return {
    diagnostics: parsed.diagnostics.slice(0, LSP_DIAGNOSTIC_CAP),
    hasErrors: parsed.hasErrors
  };
}

export function queryAgentScriptLsp(input: {
  source: string;
  dialect: AgentScriptDialect;
  uri?: string;
  query?: AgentScriptLspQuery;
  line?: number;
  column?: number;
}): { ok: true; result: AgentScriptLspResult } | { ok: false; error: string } {
  const query = input.query ?? 'diagnostics';
  if (!isAgentScriptLspQuery(query)) {
    return { ok: false, error: `Unknown LSP query. Use ${AGENT_SCRIPT_LSP_QUERIES.join(', ')}.` };
  }
  const needsPosition = POSITION_QUERIES.has(query);
  const line = typeof input.line === 'number' && Number.isFinite(input.line) ? Math.max(0, Math.floor(input.line)) : undefined;
  const column =
    typeof input.column === 'number' && Number.isFinite(input.column) ? Math.max(0, Math.floor(input.column)) : undefined;
  if (needsPosition && (line === undefined || column === undefined)) {
    return { ok: false, error: `${query} requires line and column (0-based).` };
  }

  let state: DocumentState;
  try {
    state = analyzeAgentScriptDocument(input.source, input.dialect, input.uri);
  } catch {
    const fallback = fallbackDiagnostics(input.source, input.dialect);
    if (query !== 'diagnostics') {
      return { ok: false, error: 'Agent Script language service failed to analyze this file.' };
    }
    return {
      ok: true,
      result: { dialect: input.dialect, query, ...fallback }
    };
  }

  const diagnostics = state.diagnostics.slice(0, LSP_DIAGNOSTIC_CAP).map(mapDiagnostic);
  const hasErrors = diagnostics.some((row) => row.severity === 'error') || state.diagnostics.some((row) => row.severity === 1);
  const base: AgentScriptLspResult = { dialect: input.dialect, query, diagnostics, hasErrors };

  if (query === 'diagnostics') return { ok: true, result: base };
  if (query === 'symbols') {
    return {
      ok: true,
      result: { ...base, symbols: flattenSymbols(provideDocumentSymbols(state), LSP_SYMBOL_CAP) }
    };
  }

  const atLine = line!;
  const atColumn = column!;
  if (query === 'hover') {
    const hover = hoverMarkdown(provideHover(state, atLine, atColumn, lspDialects()));
    return { ok: true, result: { ...base, ...(hover ? { hover: hover.markdown, range: hover.range } : {}) } };
  }
  if (query === 'complete') {
    const list = provideCompletion(state, atLine, atColumn, undefined, lspDialects());
    const completions = (list?.items ?? []).slice(0, LSP_COMPLETION_CAP).map((item) => ({
      label: item.label,
      ...(typeof item.kind === 'number' ? { kind: item.kind } : {}),
      ...(typeof item.detail === 'string' ? { detail: item.detail } : {}),
      ...(typeof item.insertText === 'string' ? { insertText: item.insertText } : {})
    }));
    return { ok: true, result: { ...base, completions } };
  }

  const definition: LspLocation | null = provideDefinition(state, atLine, atColumn);
  return {
    ok: true,
    result: { ...base, ...(definition ? { definition: mapRange(definition.range) } : {}) }
  };
}
