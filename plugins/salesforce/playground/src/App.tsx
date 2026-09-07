import { useCallback, useEffect, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import { parseAgentScriptSource } from '../../lib/agent-script-parse.js';
import { queryAgentScriptLsp } from '../../lib/agent-script-lsp.js';
import { dialectLabel, normalizePlaygroundView, type PlaygroundView } from '../../lib/agent-script-chrome.js';
import {
  DEFAULT_SPLIT_RATIO,
  splitRatioFromClientX,
  splitRatioFromKey
} from '../../lib/agent-script-split.js';
import type { AgentScriptDialect, PublicOrgView } from '../../lib/types.js';
import {
  graphFromAgentSource,
  type AgentGraphEdge,
  type AgentGraphNode
} from '../../lib/agent-script-model.js';
import {
  isHostToPlayground,
  PLAYGROUND_BRIDGE_SOURCE,
  type HostToPlayground
} from '../../src/app/playground-bridge.js';
import { orgSessionLabel } from '../../lib/org-session.js';
import { applyDiagnostics, ensureAgentScriptMonaco, setAgentScriptLspDialect } from './editor';
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
  const [view, setView] = useState<PlaygroundView>('script');
  const [graph, setGraph] = useState<{ nodes: AgentGraphNode[]; edges: AgentGraphEdge[] }>({
    nodes: [],
    edges: []
  });
  const [issueCount, setIssueCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [org, setOrg] = useState<PublicOrgView | null>(null);
  const [splitRatio, setSplitRatio] = useState(DEFAULT_SPLIT_RATIO);
  const splitRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const refreshAnalysis = useCallback((source: string, nextDialect: AgentScriptDialect) => {
    setAgentScriptLspDialect(nextDialect);
    const parsed = parseAgentScriptSource(source, nextDialect);
    const lsp = queryAgentScriptLsp({ source, dialect: nextDialect, query: 'diagnostics' });
    const diagnostics = lsp.ok ? lsp.result.diagnostics : parsed.diagnostics;
    setGraph(parsed.graph.nodes.length > 0 ? parsed.graph : graphFromAgentSource(source));
    setIssueCount(diagnostics.length);
    setErrorCount(diagnostics.filter((row) => row.severity === 'error').length);
    if (modelRef.current) applyDiagnostics(modelRef.current, diagnostics);
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
      fontSize: 14,
      lineNumbers: 'on',
      wordWrap: 'on',
      scrollBeyondLastLine: false,
      padding: { top: 8, bottom: 12 },
      renderLineHighlight: 'line',
      cursorBlinking: 'smooth',
      smoothScrolling: true,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      wordBasedSuggestions: 'off',
      quickSuggestions: true,
      fixedOverflowWidgets: true
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
        if (message.view) setView(normalizePlaygroundView(message.view));
        if ('org' in message) setOrg(message.org ?? null);
        return;
      }
      if (message.type === 'setOrg') {
        setOrg(message.org);
        return;
      }
      if (message.type === 'setTheme') {
        setTheme(message.theme);
        return;
      }
      if (message.type === 'setView') {
        setView(normalizePlaygroundView(message.view));
        return;
      }
      if (message.type === 'setDialect') {
        setDialect(message.dialect);
        setAgentScriptLspDialect(message.dialect);
        refreshAnalysis(editorRef.current?.getValue() ?? '', message.dialect);
        return;
      }
      if (message.type === 'setFile') {
        pathRef.current = message.path;
        setDialect(message.dialect);
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

  const applySplitFromClientX = useCallback((clientX: number) => {
    const rect = splitRef.current?.getBoundingClientRect();
    if (!rect) return;
    setSplitRatio(splitRatioFromClientX(clientX, rect.left, rect.width));
  }, []);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!draggingRef.current) return;
      event.preventDefault();
      applySplitFromClientX(event.clientX);
    };
    const onUp = () => {
      draggingRef.current = false;
      document.body.classList.remove('is-resizing-split');
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [applySplitFromClientX]);

  return (
    <div
      className={`ide ${theme}`}
      data-view={view}
      data-testid="agent-script-ide"
      style={{ ['--split-editor' as string]: String(splitRatio) }}
    >
      <div className="split" ref={splitRef}>
        <section className="pane editor">
          <header className="pane-header">Agent Definition</header>
          <div className="pane-body" id="editor-host" />
        </section>
        <div
          className="split-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Script and Graph"
          aria-valuemin={28}
          aria-valuemax={72}
          aria-valuenow={Math.round(splitRatio * 100)}
          tabIndex={0}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            draggingRef.current = true;
            document.body.classList.add('is-resizing-split');
            applySplitFromClientX(event.clientX);
          }}
          onDoubleClick={() => setSplitRatio(DEFAULT_SPLIT_RATIO)}
          onKeyDown={(event) => {
            const next = splitRatioFromKey(splitRatio, event.key);
            if (next == null) return;
            event.preventDefault();
            setSplitRatio(next);
          }}
        />
        <section className="pane graph">
          <header className="pane-header">Graph</header>
          <div className="pane-body">
            <AgentGraph nodes={graph.nodes} edges={graph.edges} />
          </div>
        </section>
      </div>
      <footer className="statusbar">
        <span className="statusbar-left">
          <span className={`diag-dot ${errorCount > 0 ? 'is-error' : issueCount > 0 ? '' : 'is-ok'}`} />
          <span>
            {issueCount === 0
              ? 'No problems'
              : `${issueCount} diagnostic${issueCount === 1 ? '' : 's'}`}
          </span>
        </span>
        <span className="statusbar-right">
          {orgSessionLabel(org) ?? 'No org'}
          {' · '}
          {dialectLabel(dialect)}
        </span>
      </footer>
    </div>
  );
}
