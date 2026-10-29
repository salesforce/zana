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
import { bindEditorSelectionCopy } from './editor-selection-copy';
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

  // `disk` is a newer version on disk, offered over unsaved edits; until it is resolved a save still conflicts.
  const draftRef = useRef<{ key?: string; baseSha?: string; baseline: string; applying: boolean; disk?: { content: string; sha256: string; proposalId: string } }>({ baseline: '', applying: false });
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
  // Unsaved edits stay; the version on disk is offered hunk by hunk. Once the person decides, the edits sit on that version.
  const proposeDiskVersion = (content: string, sha256: string) => {
    const proposalId = `disk:${sha256.slice(0, 16)}`;
    draftRef.current.disk = { content, sha256, proposalId };
    layerRef.current?.setProposal({ proposalId, content, summary: 'Accept takes the new version, Reject keeps your edits', actor: 'File changed on disk' });
  };
  const onLayerPost = (message: Record<string, unknown>) => {
    const draft = draftRef.current;
    const disk = draft.disk;
    // A proposal closed by a file switch or a newer proposal (`note`) was not decided, so a save keeps conflicting.
    if (message.type === 'proposalResolved' && disk && disk.proposalId === message.proposalId && !message.note) {
      draft.baseline = disk.content;
      draft.baseSha = disk.sha256;
      draft.disk = undefined;
      publishDraft(editorRef.current?.getValue() ?? '');
    }
    postToHost(message);
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
    const releaseSelectionCopy = bindEditorSelectionCopy(container, instance, () => pathRef.current);
    const layer = new StudioLayer(host, instance, onLayerPost);
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
      releaseSelectionCopy();
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
      if (message.type === 'setReadOnly') {
        const instance = editorRef.current;
        const model = modelRef.current;
        instance?.updateOptions({ readOnly: message.readOnly, domReadOnly: message.readOnly });
        if (message.baseline !== undefined && message.baseSha) {
          // The shared document's saved version: a disk version offered against the old baseline no longer applies.
          const draft = draftRef.current;
          if (draft.disk) layerRef.current?.clearProposal(draft.disk.proposalId);
          draft.baseline = message.baseline;
          draft.baseSha = message.baseSha;
          draft.disk = undefined;
          if (!message.readOnly && (message.content === undefined || model?.getValue() === message.content)) publishDraft(model?.getValue() ?? '');
        }
        if (message.content === undefined || !model || model.getValue() === message.content) return;
        if (message.readOnly) {
          // A follower shows the holder's text; it is not this window's draft, so nothing is published.
          draftRef.current.applying = true;
          model.setValue(message.content);
          draftRef.current.applying = false;
          refreshAnalysis(message.content, dialectRef.current);
        } else {
          // One undoable edit; the content listener republishes the draft and the analysis.
          model.pushEditOperations([], [{ range: model.getFullModelRange(), text: message.content }], () => null);
        }
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
        // A draft written against an older version keeps its edits and is offered what is on disk now.
        const stale = Boolean(recovered?.baseSha && message.sha256 && recovered.baseSha !== message.sha256);
        draftRef.current = { key: message.draftKey, baseline: message.content, baseSha: stale && recovered!.content === message.content ? message.sha256 : recovered?.baseSha ?? message.sha256, applying: true };
        const value = recovered?.content ?? message.content;
        layerRef.current?.onFileSwitched();
        const model = modelRef.current;
        if (model && model.getValue() !== value) model.setValue(value);
        draftRef.current.applying = false;
        publishDraft(value);
        refreshAnalysis(value, nextDialect);
        if (stale && value !== message.content) proposeDiskVersion(message.content, message.sha256!);
        return;
      }
      if (message.type === 'fileChanged') {
        const draft = draftRef.current;
        if (message.draftKey !== draft.key || message.sha256 === draft.baseSha || message.sha256 === draft.disk?.sha256) return;
        const model = modelRef.current;
        const current = model?.getValue() ?? '';
        if (current !== draft.baseline && current !== message.content) { proposeDiskVersion(message.content, message.sha256); return; }
        draft.baseline = message.content;
        draft.baseSha = message.sha256;
        draft.disk = undefined;
        if (model && current !== message.content) {
          // One undoable edit; the content listener republishes the draft and the analysis.
          model.pushEditOperations([], [{ range: model.getFullModelRange(), text: message.content }], () => null);
          return;
        }
        publishDraft(current);
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
