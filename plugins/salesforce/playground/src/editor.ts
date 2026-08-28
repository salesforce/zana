import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { AgentforceSchema } from '@sf-agentscript/agentforce';
import { registerAgentScriptLanguage, type SchemaFieldInfo } from '@sf-agentscript/monaco';
import type { AgentScriptDiagnostic } from '../../lib/agent-script-model.js';

const globalScope = self as unknown as { MonacoEnvironment?: { getWorker(): Worker } };
globalScope.MonacoEnvironment = {
  getWorker() {
    return new EditorWorker();
  }
};

const SCHEMA_KEYS = Object.keys(AgentforceSchema);
const EXTRA_KEYWORDS = [
  'topic',
  'start_agent',
  'subagent',
  'transition',
  'reasoning',
  'description',
  'instructions',
  'config',
  'system',
  'variables',
  'actions',
  'run',
  'if',
  'else'
];

let registered = false;

function registerCompletions(): void {
  monaco.languages.registerCompletionItemProvider('agentscript', {
    triggerCharacters: ['@', '.', ' ', ':'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      };
      const labels = [...new Set([...SCHEMA_KEYS, ...EXTRA_KEYWORDS])];
      return {
        suggestions: labels.map((label) => ({
          label,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: label,
          range
        }))
      };
    }
  });
}

export function ensureAgentScriptMonaco(): typeof monaco {
  if (!registered) {
    registered = true;
    // Standalone Monaco: highlighting + hover come from @sf-agentscript/monaco.
    // Full lsp-browser needs monaco-vscode-api; keyword completions cover the iframe IDE.
    void registerAgentScriptLanguage({
      schema: AgentforceSchema as unknown as Record<string, SchemaFieldInfo>
    });
    registerCompletions();
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
