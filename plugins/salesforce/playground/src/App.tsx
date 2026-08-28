import { useCallback, useEffect, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import { parseAgentScriptSource } from '../../lib/agent-script-parse.js';
import { AGENT_SCRIPT_DIALECTS, type AgentScriptDialect } from '../../lib/types.js';
import {
  graphFromAgentSource,
  type AgentGraphEdge,
  type AgentGraphNode,
  type AgentScriptExample
} from '../../lib/agent-script-model.js';
import {
  isHostToPlayground,
  PLAYGROUND_BRIDGE_SOURCE,
  type HostToPlayground
} from '../../src/app/playground-bridge.js';
import { applyDiagnostics, ensureAgentScriptMonaco } from './editor';
import { AgentGraph } from './graph';

function postToHost(message: Record<string, unknown>): void {
  window.parent.postMessage({ source: PLAYGROUND_BRIDGE_SOURCE, ...message }, window.location.origin);
}

export default function App() {
  const host = ensureAgentScriptMonaco();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<editor.ITextModel | null>(null);
  const pathRef = useRef<string | null>(null);
  const dialectRef = useRef<AgentScriptDialect>('agentforce');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [dialect, setDialect] = useState<AgentScriptDialect>('agentforce');
  const [graph, setGraph] = useState<{ nodes: AgentGraphNode[]; edges: AgentGraphEdge[] }>({
    nodes: [],
    edges: []
  });
  const [issueCount, setIssueCount] = useState(0);
  const [examples, setExamples] = useState<readonly AgentScriptExample[]>([]);
  const [exampleId, setExampleId] = useState('');

  const refreshAnalysis = useCallback((source: string, nextDialect: AgentScriptDialect) => {
    const parsed = parseAgentScriptSource(source, nextDialect);
    setGraph(parsed.graph.nodes.length > 0 ? parsed.graph : graphFromAgentSource(source));
    setIssueCount(parsed.diagnostics.length);
    if (modelRef.current) applyDiagnostics(modelRef.current, parsed.diagnostics);
  }, []);

  useEffect(() => {
    dialectRef.current = dialect;
  }, [dialect]);

  useEffect(() => {
    const container = document.getElementById('editor-host');
    if (!container) return;
    const model = host.editor.createModel('', 'agentscript');
    modelRef.current = model;
    const instance = host.editor.create(container, {
      model,
      theme: theme === 'light' ? 'agentscript-light' : 'agentscript-dark',
      automaticLayout: true,
      minimap: { enabled: false },
      fontSize: 13,
      scrollBeyondLastLine: false
    });
    editorRef.current = instance;
    const sub = instance.onDidChangeModelContent(() => {
      postToHost({ type: 'dirty', dirty: true });
      refreshAnalysis(instance.getValue(), dialectRef.current);
    });
    postToHost({ type: 'ready' });
    return () => {
      sub.dispose();
      instance.dispose();
      model.dispose();
    };
  }, [host, refreshAnalysis]);

  useEffect(() => {
    editorRef.current?.updateOptions({
      theme: theme === 'light' ? 'agentscript-light' : 'agentscript-dark'
    });
    host.editor.setTheme(theme === 'light' ? 'agentscript-light' : 'agentscript-dark');
  }, [host, theme]);

  const applyHostMessage = useCallback(
    (message: HostToPlayground) => {
      if (message.type === 'init') {
        setTheme(message.theme);
        setDialect(message.dialect);
        setExamples(message.examples);
        return;
      }
      if (message.type === 'setTheme') {
        setTheme(message.theme);
        return;
      }
      if (message.type === 'setDialect') {
        setDialect(message.dialect);
        refreshAnalysis(editorRef.current?.getValue() ?? '', message.dialect);
        return;
      }
      if (message.type === 'setFile') {
        pathRef.current = message.path;
        setDialect(message.dialect);
        setExampleId('');
        const value = message.content;
        const model = modelRef.current;
        if (model && model.getValue() !== value) model.setValue(value);
        refreshAnalysis(value, message.dialect);
        postToHost({ type: 'dirty', dirty: false });
        return;
      }
      if (message.type === 'saved') {
        postToHost({ type: 'dirty', dirty: false });
        return;
      }
      if (message.type === 'flushSave') {
        const path = pathRef.current;
        const content = editorRef.current?.getValue() ?? '';
        if (path) postToHost({ type: 'persist', path, content });
      }
    },
    [refreshAnalysis]
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isHostToPlayground(event.data)) return;
      applyHostMessage(event.data);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [applyHostMessage]);

  return (
    <div className={`ide ${theme}`}>
      <div className="toolbar">
        <span>Agent Script playground</span>
        <label>
          Dialect
          <select
            aria-label="Agent Script dialect"
            value={dialect}
            onChange={(event) => {
              const next = event.target.value as AgentScriptDialect;
              setDialect(next);
              refreshAnalysis(editorRef.current?.getValue() ?? '', next);
            }}
          >
            {AGENT_SCRIPT_DIALECTS.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        {examples.length > 0 ? (
          <label>
            Example
            <select
              aria-label="Agent Script example"
              value={exampleId}
              onChange={(event) => {
                const next = event.target.value;
                const example = examples.find((row) => row.id === next);
                if (!example) {
                  setExampleId('');
                  return;
                }
                setExampleId(example.id);
                setDialect(example.dialect);
                pathRef.current = null;
                const model = modelRef.current;
                if (model) model.setValue(example.source);
                refreshAnalysis(example.source, example.dialect);
                postToHost({ type: 'dirty', dirty: true });
              }}
            >
              <option value="">Current buffer</option>
              {examples.map((example) => (
                <option key={example.id} value={example.id}>
                  {example.title}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span>
          {issueCount} diagnostic{issueCount === 1 ? '' : 's'}
        </span>
      </div>
      <div className="split">
        <div className="editor" id="editor-host" />
        <div className="graph">
          <AgentGraph nodes={graph.nodes} edges={graph.edges} />
        </div>
      </div>
    </div>
  );
}
