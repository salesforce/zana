import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { AgentforceSchema } from '@sf-agentscript/agentforce';
import { registerAgentScriptLanguage, type SchemaFieldInfo } from '@sf-agentscript/monaco';
import type { AgentScriptDiagnostic } from '../../lib/agent-script-model.js';
import { queryAgentScriptLsp } from '../../lib/agent-script-lsp.js';
import type { AgentScriptDialect } from '../../lib/types.js';

const globalScope = self as unknown as { MonacoEnvironment?: { getWorker(): Worker } };
globalScope.MonacoEnvironment = {
  getWorker() {
    return new EditorWorker();
  }
};

let registered = false;
let dialectForLsp: AgentScriptDialect = 'agentforce';

export function setAgentScriptLspDialect(dialect: AgentScriptDialect): void {
  dialectForLsp = dialect;
}

function lspRangeToMonaco(range: { start: { line: number; column: number }; end: { line: number; column: number } }): monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.column + 1,
    endLineNumber: range.end.line + 1,
    endColumn: Math.max(range.end.column + 1, range.start.column + 2)
  };
}

function wordRange(model: monaco.editor.ITextModel, position: monaco.Position): monaco.IRange {
  const word = model.getWordUntilPosition(position);
  return {
    startLineNumber: position.lineNumber,
    endLineNumber: position.lineNumber,
    startColumn: word.startColumn,
    endColumn: word.endColumn
  };
}

function registerLspProviders(): void {
  monaco.languages.registerCompletionItemProvider('agentscript', {
    triggerCharacters: ['@', '.', ' ', ':', '#'],
    provideCompletionItems(model, position) {
      const queried = queryAgentScriptLsp({
        source: model.getValue(),
        dialect: dialectForLsp,
        query: 'complete',
        line: position.lineNumber - 1,
        column: position.column - 1
      });
      const range = wordRange(model, position);
      const completions = queried.ok ? queried.result.completions ?? [] : [];
      return {
        suggestions: completions.map((item) => ({
          label: item.label,
          kind:
            typeof item.kind === 'number'
              ? (item.kind as monaco.languages.CompletionItemKind)
              : monaco.languages.CompletionItemKind.Field,
          insertText: item.insertText ?? item.label,
          detail: item.detail,
          range
        }))
      };
    }
  });

  monaco.languages.registerHoverProvider('agentscript', {
    provideHover(model, position) {
      const queried = queryAgentScriptLsp({
        source: model.getValue(),
        dialect: dialectForLsp,
        query: 'hover',
        line: position.lineNumber - 1,
        column: position.column - 1
      });
      if (!queried.ok || !queried.result.hover) return null;
      return {
        contents: [{ value: queried.result.hover }],
        ...(queried.result.range ? { range: lspRangeToMonaco(queried.result.range) } : {})
      };
    }
  });

  monaco.languages.registerDefinitionProvider('agentscript', {
    provideDefinition(model, position) {
      const queried = queryAgentScriptLsp({
        source: model.getValue(),
        dialect: dialectForLsp,
        query: 'definition',
        line: position.lineNumber - 1,
        column: position.column - 1
      });
      if (!queried.ok || !queried.result.definition) return null;
      return {
        uri: model.uri,
        range: lspRangeToMonaco(queried.result.definition)
      };
    }
  });
}

export function ensureAgentScriptMonaco(): typeof monaco {
  if (!registered) {
    registered = true;
    void registerAgentScriptLanguage({
      schema: AgentforceSchema as unknown as Record<string, SchemaFieldInfo>
    });
    registerLspProviders();
  }
  return monaco;
}

export function applyDiagnostics(model: monaco.editor.ITextModel, diagnostics: AgentScriptDiagnostic[]): void {
  monaco.editor.setModelMarkers(
    model,
    'agentscript',
    diagnostics.map((row) => ({
      startLineNumber: row.line + 1,
      startColumn: Math.max(1, row.column + 1),
      endLineNumber: row.endLine + 1,
      endColumn: Math.max(row.endColumn + 1, row.column + 2),
      message: row.message,
      severity:
        row.severity === 'warning'
          ? monaco.MarkerSeverity.Warning
          : row.severity === 'info' || row.severity === 'hint'
            ? monaco.MarkerSeverity.Info
            : monaco.MarkerSeverity.Error
    }))
  );
}
