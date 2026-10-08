import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ThreadChat, useZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { ArrowLeft, AtSign, Bot, ChevronDown, ExternalLink, Sparkles, Unlink } from 'lucide-react';
import { AGENT_ACTIONS, MAX_AGENT_PROMPT_LENGTH } from '../shared/agent-actions.js';
import type { DesignDocDetail, ThreadRole } from '../shared/contract.js';
import { errorMessage, toast, useApi } from './api.js';
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
 * The doc's linked threads. With `onOpenChat` a thread opens embedded in the
 * rail beside the doc; without it (the doc is already beside a thread) it
 * navigates to the thread.
 */
export function AgentsPane({
  doc,
  now,
  chatThreadId = null,
  onOpenChat
}: {
  doc: DesignDocDetail;
  now: number;
  chatThreadId?: string | null;
  onOpenChat?(threadId: string | null): void;
}) {
  const api = useApi();
  const navigate = useZccNavigate();
  const threads = [...doc.threads].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  const chat = onOpenChat ? threads.find((thread) => thread.threadId === chatThreadId) : undefined;
  if (chat && onOpenChat) {
    return (
      <div className="dd-rail-pane dd-agents dd-agent-chat">
        <div className="dd-agent-chat-head">
          <IconButton icon={ArrowLeft} label="All agents" size={13} onClick={() => onOpenChat(null)} />
          <span className="dd-agent-chat-title" title={chat.title}>
            {chat.title}
          </span>
          <span className={`dd-role dd-role-${chat.role}`}>{ROLE_LABELS[chat.role]}</span>
          <IconButton icon={ExternalLink} label="Open full thread" size={13} onClick={() => navigate.toThread(chat.threadId)} />
        </div>
        <ThreadChat threadId={chat.threadId} variant="compact" layout="contained" className="dd-agent-chat-body" />
      </div>
    );
  }
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
                  onClick={() => (onOpenChat ? onOpenChat(thread.threadId) : navigate.toThread(thread.threadId))}
                  title={onOpenChat ? 'Open chat beside the doc' : 'Open thread'}
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
  /** Changes on every request so the same text can be asked twice. */
  nonce: number;
}

/**
 * "Ask agent": a one-click action or a free-form request starts a new thread
 * briefed on this doc, then opens it with the doc beside the conversation so
 * the user watches the agent's edits land.
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
  const [focusFile, setFocusFile] = useState(false);
  const [projectId, setProjectId] = useState<string>(contextProjectId ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const projects = useProjects();
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const needsProject = !doc.projectId;
  const projectOptions = projects.data ?? [];
  const chosenProject = needsProject ? projectId || projectOptions[0]?.id || '' : doc.projectId!;

  useEffect(() => {
    if (!request) return;
    setPrompt(request.prompt);
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
    setBusy(action ?? 'custom');
    try {
      const result = await api.askAgent(doc.id, {
        ...(action ? { action } : {}),
        ...(prompt.trim() && !action ? { prompt: prompt.trim() } : {}),
        path: focusFile ? activePath : null,
        ...(needsProject ? { projectId: chosenProject } : {})
      });
      navigate.openThreadPanel({ actionId: DOC_PANEL_ACTION, title: doc.title, params: { docId: doc.id }, threadId: result.threadId });
      navigate.toThread(result.threadId);
      toast(`Agent started on “${doc.title}”. Its edits appear here live.`);
      setOpen(false);
      setPrompt('');
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
        <span className="dd-muted">Starts a new thread that edits this doc live</span>
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
        <textarea
          ref={inputRef}
          className="dd-input"
          rows={3}
          maxLength={MAX_AGENT_PROMPT_LENGTH}
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
