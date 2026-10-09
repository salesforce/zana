import { readAgentDraft, writeAgentDraft, clearAgentDraft } from '../../src/app/agent-script-drafts.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { editor } from 'monaco-editor';
import { parseAgentScriptSource } from '../../lib/agent-script-parse.js';
import { queryAgentScriptLsp } from '../../lib/agent-script-lsp.js';
import { dialectLabel } from '../../lib/agent-script-chrome.js';
import type { AgentScriptDialect, PublicOrgView } from '../../lib/types.js';
import {
  isHostToPlayground,
  PLAYGROUND_BRIDGE_SOURCE,
  type HostToPlayground
} from '../../src/app/playground-bridge.js';
import { orgSessionLabel } from '../../lib/org-session.js';
import { applyDiagnostics, ensureAgentScriptMonaco, setAgentScriptLspDialect } from './editor';
import { StudioLayer } from './studio-layer';
import { toStudioDiagnostics } from './studio-helpers';
import type { AgentAction } from '../../lib/agent-action-model';

function postToHost(message: Record<string, unknown>): void {
  window.parent.postMessage({ source: PLAYGROUND_BRIDGE_SOURCE, ...message }, window.location.origin);
}

export default function App() {
  const host = ensureAgentScriptMonaco();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const actionsRef = useRef<AgentAction[]>([]);
  const modelRef = useRef<editor.ITextModel | null>(null);
  const pathRef = useRef<string | null>(null);
  const dialectRef = useRef<AgentScriptDialect>('agentforce');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [dialect, setDialect] = useState<AgentScriptDialect>('agentforce');
  const [compact, setCompact] = useState(false);
  const layerRef = useRef<StudioLayer | null>(null);
  const [issueCount, setIssueCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);
  const [org, setOrg] = useState<PublicOrgView | null>(null);

  const draftRef = useRef<{ key?: string; baseSha?: string; baseline: string; applying: boolean }>({ baseline: '', applying: false });
  const publishDraft = (content: string) => {
    const draft = draftRef.current;
    const dirty = content !== draft.baseline;
    let persisted = true;
    if (draft.key) {
      if (dirty) persisted = writeAgentDraft({ key: draft.key, content, baseSha: draft.baseSha, dialect: dialectRef.current });
      else clearAgentDraft(draft.key);
    }
    postToHost({ type: 'dirty', dirty, draftKey: draft.key, baseSha: draft.baseSha, persisted });
  };
  const refreshAnalysis = useCallback((source: string, nextDialect: AgentScriptDialect) => {
    setAgentScriptLspDialect(nextDialect);
    const parsed = parseAgentScriptSource(source, nextDialect);
    actionsRef.current = parsed.actions;
    const lsp = queryAgentScriptLsp({ source, dialect: nextDialect, query: 'diagnostics' });
    const diagnostics = lsp.ok ? lsp.result.diagnostics : parsed.diagnostics;
    setIssueCount(diagnostics.length);
    setErrorCount(diagnostics.filter((row) => row.severity === 'error').length);
    postToHost({ type: 'snapshot', draftKey: draftRef.current.key, content: source, issues: diagnostics.length, actions: parsed.actions, diagnostics: toStudioDiagnostics(diagnostics) });
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
      'semanticHighlighting.enabled': true,
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
      fixedOverflowWidgets: true,
      glyphMargin: true
    });
    editorRef.current = instance;
    const layer = new StudioLayer(host, instance, postToHost);
    layerRef.current = layer;
    const sub = instance.onDidChangeModelContent(() => {
      if (draftRef.current.applying) return;
      publishDraft(instance.getValue());
      refreshAnalysis(instance.getValue(), dialectRef.current);
    });
    const targetClick = instance.onMouseDown(event => {
      if (!event.event.ctrlKey && !event.event.metaKey) return;
      const line = event.target.position?.lineNumber;
      if (!line || !/^\s*target\s*:/.test(model.getLineContent(line))) return;
      const action = actionsRef.current.filter(a => a.target && a.line <= line && model.getLineContent(line).includes(a.target)).sort((a, b) => b.line - a.line)[0];
      if (action) postToHost({ type: 'openAction', id: action.id });
    });
    postToHost({ type: 'ready' });
    return () => {
      sub.dispose();
      targetClick.dispose();
      layer.dispose();
      layerRef.current = null;
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
      if (message.type === 'revealLine') {
        editorRef.current?.revealLineInCenter(message.line);
        editorRef.current?.setPosition({ lineNumber: message.line, column: 1 });
        editorRef.current?.focus();
        return;
      }
      if (message.type === 'init') {
        setTheme(message.theme);
        setDialect(message.dialect);
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
      if (message.type === 'proposeEdit') {
        layerRef.current?.setProposal(message);
        return;
      }
      if (message.type === 'clearProposal') {
        layerRef.current?.clearProposal(message.proposalId);
        return;
      }
      if (message.type === 'setComments') {
        layerRef.current?.setComments(message.comments);
        return;
      }
      if (message.type === 'setHits') {
        layerRef.current?.setHits(message.lines);
        return;
      }
      if (message.type === 'setLayout') {
        setCompact(message.compact);
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
        const recovered = message.draftKey ? readAgentDraft(message.draftKey) : undefined;
        const nextDialect = message.dialect;
        dialectRef.current = nextDialect;
        setDialect(nextDialect);
        draftRef.current = { key: message.draftKey, baseline: message.content, baseSha: recovered?.baseSha ?? message.sha256, applying: true };
        const value = recovered?.content ?? message.content;
        layerRef.current?.onFileSwitched();
        const model = modelRef.current;
        if (model && model.getValue() !== value) model.setValue(value);
        draftRef.current.applying = false;
        publishDraft(value);
        refreshAnalysis(value, nextDialect);
        return;
      }
      if (message.type === 'saved') {
        if (message.draftKey && message.draftKey !== draftRef.current.key) return;
        draftRef.current.baseSha = message.sha256;
        draftRef.current.baseline = message.content ?? editorRef.current?.getValue() ?? '';
        publishDraft(editorRef.current?.getValue() ?? '');
        return;
      }
      if (message.type === 'flushSave') {
        const path = message.path ?? pathRef.current;
        const content = editorRef.current?.getValue() ?? '';
        if (path) postToHost({ type: 'persist', path, content, draftKey: draftRef.current.key, create: message.create });
      }
    },
    [refreshAnalysis]
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== window.parent) return;
      if (!isHostToPlayground(event.data)) return;
      applyHostMessage(event.data);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [applyHostMessage]);

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize: compact ? 13 : 14, lineNumbers: compact ? 'off' : 'on' });
  }, [compact]);

  return (
    <div className={`ide ${theme}${compact ? ' compact' : ''}`} data-view="script" data-testid="agent-script-ide">
      <div className="split">
        <section className="pane editor">
          <div className="pane-body" id="editor-host" />
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
