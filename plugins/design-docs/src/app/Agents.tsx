import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { editorSelectionLabel, editorSelectionPrompt, useZccNavigate, type EditorSelection, type ZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { AtSign, Bot, ChevronDown, FileText, Sparkles, Unlink, X } from 'lucide-react';
import { AGENT_ACTIONS, agentActionById, buildAgentPrompt, MAX_AGENT_PROMPT_LENGTH } from '../shared/agent-actions.js';
import type { DesignDocDetail, ThreadRole } from '../shared/contract.js';
import { defaultAgentProject, errorMessage, toast, useApi } from './api.js';
import { useProjects } from './hooks.js';
import { actionIcon, EmptyState, IconButton, Popover, Spinner, TimeAgo } from './ui.js';

const ROLE_LABELS: Record<ThreadRole, string> = {
  author: 'Author',
  editor: 'Editor',
  reviewer: 'Reviewer',
  assistant: 'Assistant'
};

/** The thread-panel action id shared by the directive card, the message action and Ask agent. */
export const DOC_PANEL_ACTION = 'design-doc';

/**
 * Show an agent a doc started. It opens in this page's side panel, so the user
 * stays on the doc; a host without one shows the doc beside the agent's thread.
 */
export function showDocAgent(navigate: ZccNavigate, doc: { id: string; title: string }, threadId: string): void {
  // Optional call: hosts older than the side-panel agent lack it.
  if (navigate.openPanelAgent?.({ threadId, title: doc.title })) return;
  navigate.openThreadPanel({ actionId: DOC_PANEL_ACTION, title: doc.title, params: { docId: doc.id }, threadId });
  navigate.toThread(threadId);
}

/**
 * Hand a doc request to the side panel's composer, prefilled, so the user
 * picks the harness and sends it there. False when the host has no side panel
 * composer (or predates drafts): the caller then starts the thread itself.
 */
export function draftDocAgent(
  navigate: ZccNavigate,
  doc: { id: string; title: string },
  request: { action?: string | null; prompt?: string; path?: string | null; projectId?: string | null; selection?: EditorSelection | null }
): boolean {
  if (!navigate.openPanelAgent) return false;
  const prompt = buildAgentPrompt({
    doc,
    action: request.action ? agentActionById(request.action) : null,
    prompt: request.prompt,
    path: request.path
  });
  return navigate.openPanelAgent({
    // The doc id is the page's view, so the conversation joins this doc's Agents list.
    draft: { prompt, view: doc.id, ...(request.projectId ? { projectId: request.projectId } : {}), ...(request.selection ? { selection: request.selection } : {}) },
    title: doc.title
  });
}

/** Linked conversations use the host's agent tabs; a doc beside a thread navigates there. */
export function AgentsPane({
  doc,
  now,
  openInPanel = true
}: {
  doc: DesignDocDetail;
  now: number;
  openInPanel?: boolean;
}) {
  const api = useApi();
  const navigate = useZccNavigate();
  const threads = [...doc.threads].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  return (
    <div className="dd-rail-pane dd-agents">
      <div className="dd-rail-scroll">
        {threads.length ? (
          <ul className="dd-thread-list">
            {threads.map((thread) => (
              <li key={thread.threadId} className="dd-thread">
                <button
                  type="button"
                  className="dd-thread-open"
                  onClick={() => openInPanel ? showDocAgent(navigate, doc, thread.threadId) : navigate.toThread(thread.threadId)}
                  title={openInPanel ? 'Open chat beside the doc' : 'Open thread'}
                >
                  <Bot size={14} aria-hidden />
                  <span className="dd-thread-main">
                    <span className="dd-thread-title">{thread.title}</span>
                    <span className="dd-thread-meta">
                      <span className={`dd-role dd-role-${thread.role}`}>{ROLE_LABELS[thread.role]}</span>
                      <TimeAgo at={thread.lastActivityAt} now={now} />
                    </span>
                  </span>
                </button>
                <IconButton
                  icon={Unlink}
                  label="Unlink thread"
                  size={13}
                  onClick={() =>
                    void api.unlinkThread(doc.id, thread.threadId).catch((error: unknown) => toast(`Could not unlink: ${errorMessage(error)}`, 'error'))
                  }
                />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={Bot} title="No agents yet">
            Use <strong>Ask agent</strong> to start one on this doc. Threads that read or edit it show up here.
          </EmptyState>
        )}
        <div className="dd-agents-hint">
          <AtSign size={13} aria-hidden />
          <span>
            Agents in this project already know this doc exists. Type <kbd>@</kbd> in any composer to attach it, or ask them to use{' '}
            <code>design_doc_read</code>.
          </span>
        </div>
      </div>
    </div>
  );
}

export interface AskRequest {
  prompt: string;
  selection?: EditorSelection;
  /** Changes on every request so the same text can be asked twice. */
  nonce: number;
}

/**
 * "Ask agent": a one-click action or a free-form request opens the side
 * panel's composer prefilled with a brief on this doc; the user picks the
 * harness and sends, and watches the agent's edits land beside the chat. A
 * host without that composer starts the thread directly instead.
 */
export function AskAgentButton({
  doc,
  activePath,
  request,
  contextProjectId,
  compact = false
}: {
  doc: DesignDocDetail;
  activePath: string | null;
  request?: AskRequest | null;
  contextProjectId?: string | null;
  compact?: boolean;
}) {
  const api = useApi();
  const navigate = useZccNavigate();
  const [open, setOpen] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [focusFile, setFocusFile] = useState(false);
  const [projectId, setProjectId] = useState<string>(contextProjectId ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const projects = useProjects();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const needsProject = !doc.projectId;
  const projectOptions = projects.data ?? [];
  const chosenProject = needsProject ? projectId || defaultAgentProject(projectOptions) || '' : doc.projectId!;

  useEffect(() => {
    if (!request) return;
    setPrompt(request.prompt);
    setSelection(request.selection ?? null);
    setFocusFile(true);
    setOpen(true);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.selectionStart = input.selectionEnd = input.value.length;
    });
  }, [request]);

  useEffect(() => {
    if (open) setFocusFile((value) => value || (!!activePath && activePath !== doc.entryPath));
  }, [open, activePath, doc.entryPath]);

  const start = async (action: string | null) => {
    if (busy) return;
    if (needsProject && !chosenProject) {
      toast('Add a project first: agents run inside a project.', 'error');
      return;
    }
    const request = {
      action,
      prompt: action ? undefined : prompt.trim() || undefined,
      path: focusFile ? activePath : null,
      projectId: chosenProject || null,
      selection
    };
    if (draftDocAgent(navigate, doc, request)) {
      setOpen(false);
      setPrompt('');
      setSelection(null);
      return;
    }
    setBusy(action ?? 'custom');
    try {
      const result = await api.askAgent(doc.id, {
        ...(action ? { action } : {}),
        ...((!action && prompt.trim()) || selection ? { prompt: [!action ? prompt.trim() : '', selection ? editorSelectionPrompt(selection) : ''].filter(Boolean).join('\n\n') } : {}),
        path: focusFile ? activePath : null,
        ...(needsProject ? { projectId: chosenProject } : {})
      });
      showDocAgent(navigate, doc, result.threadId);
      toast(`Agent started on “${doc.title}”. Its edits appear here live.`);
      setOpen(false);
      setPrompt('');
      setSelection(null);
    } catch (error) {
      toast(`Could not start the agent: ${errorMessage(error)}`, 'error');
    } finally {
      setBusy(null);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (prompt.trim()) void start(null);
    }
  };

  return (
    <Popover
      open={open}
      onClose={() => setOpen(false)}
      className="dd-ask"
      anchor={
        <button
          type="button"
          className={`btn primary dd-ask-trigger${compact ? ' dd-ask-compact' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Sparkles size={13} aria-hidden />
          {compact ? null : 'Ask agent'}
          <ChevronDown size={12} aria-hidden />
        </button>
      }
    >
      <div className="dd-ask-head">
        <span className="dd-ask-title">Ask an agent</span>
        <span className="dd-muted">Opens a briefed composer beside the doc; pick a harness and send</span>
      </div>
      <div className="dd-ask-actions" role="menu">
        {AGENT_ACTIONS.map((action) => {
          const Glyph = actionIcon(action.icon);
          return (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className="dd-ask-action"
              disabled={!!busy}
              onClick={() => void start(action.id)}
              title={action.description}
            >
              <span className="dd-ask-action-icon">{busy === action.id ? <Spinner size={13} /> : <Glyph size={14} aria-hidden />}</span>
              <span className="dd-ask-action-text">
                <span className="dd-ask-action-label">{action.label}</span>
                <span className="dd-ask-action-desc">{action.description}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="dd-ask-custom">
        {selection ? (
          <div className="dd-ask-context">
            <details>
              <summary><FileText size={14} aria-hidden />{editorSelectionLabel(selection)}</summary>
              <pre>{selection.text}</pre>
            </details>
            <button type="button" className="icon-btn" aria-label="Remove selected passage" onClick={() => setSelection(null)}><X size={13} aria-hidden /></button>
          </div>
        ) : null}
        <textarea
          ref={inputRef}
          className="dd-input"
          rows={3}
          maxLength={Math.max(0, MAX_AGENT_PROMPT_LENGTH - (selection ? editorSelectionPrompt(selection).length + 2 : 0))}
          placeholder="Or describe what you want… e.g. “Compare two caching strategies and recommend one”"
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="dd-ask-options">
          {activePath ? (
            <label className="dd-check">
              <input type="checkbox" checked={focusFile} onChange={(event) => setFocusFile(event.target.checked)} />
              Focus on <code>{activePath}</code>
            </label>
          ) : null}
          {needsProject ? (
            <label className="dd-field-inline">
              Run in
              <select className="dd-input dd-select" value={chosenProject} onChange={(event) => setProjectId(event.target.value)}>
                {projectOptions.length ? null : <option value="">No projects</option>}
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <span className="dd-spacer" />
          <button type="button" className="btn primary" disabled={!prompt.trim() || !!busy} onClick={() => void start(null)}>
            {busy === 'custom' ? <Spinner size={12} /> : null}
            Start
          </button>
        </div>
      </div>
    </Popover>
  );
}
