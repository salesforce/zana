import { useCallback, useEffect, useState } from 'react';
import { Loader2, Send, Sparkles, Square, SquareTerminal, Workflow } from 'lucide-react';
import type { GitHostPullRequest } from '@zana-ai/zcc-domain';
import {
  isBackgroundAgentTaskType,
  LOCAL_WORKFLOW_TASK_TYPE,
  type ThreadTimelineModelFallback
} from '@zana-ai/zcc-domain/thread-runtime';
import type { TimelineViewWorkflowWorkRow } from '@zana-ai/zcc-thread-view';
import { product } from '../../../lib/product-client.js';
import { handleHttpLinkClick } from '../../../lib/in-app-browser-link-preference.js';
import { loadWorkspaceMeta } from '../secondary-panel/threadSecondaryPanelLogic.js';
import { formatWorkingElapsed } from '../thread-timeline-model.js';
import { nextTurnItemText, queuedMessagePreview } from './queued-message-text.js';

interface NextTurnItemView {
  id: string;
  text: string;
  failureReason: string | null;
  retryAt: number | null;
  status: string;
  senderThreadId: string | null;
}

export function QueuedMessagesCard({ threadId }: { threadId: string }) {
  const [items, setItems] = useState<NextTurnItemView[]>([]);
  const [paused, setPaused] = useState(false);
  const [flushing, setFlushing] = useState(false);
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [flushError, setFlushError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void product.threads.nextTurn(threadId).then((body) => {
      const payload = body as { items?: unknown; paused?: unknown } | null | undefined;
      setPaused(payload?.paused === true);
      const rows = Array.isArray(payload?.items) ? payload.items : [];
      setItems(rows.map((row) => {
        const record = row as {
          id?: string;
          payload?: string;
          input?: unknown;
          text?: unknown;
          failureReason?: unknown;
          retryAt?: unknown;
          status?: unknown;
          senderThreadId?: unknown;
        };
        const text = typeof record.text === 'string' && record.text.trim()
          ? record.text
          : nextTurnItemText(record);
        return {
          id: typeof record.id === 'string' ? record.id : '',
          text,
          failureReason: typeof record.failureReason === 'string' ? record.failureReason : null,
          status: typeof record.status === 'string' ? record.status : 'queued',
          retryAt: typeof record.retryAt === 'number' ? record.retryAt : null,
          senderThreadId: typeof record.senderThreadId === 'string' && record.senderThreadId.trim()
            ? record.senderThreadId.trim()
            : null
        };
      }).filter((row) => row.id));
    }).catch(() => undefined);
  }, [threadId]);

  useEffect(() => {
    refresh();
    const stop = product.threads.onUpdated((payload) => {
      if (payload && typeof payload === 'object' && 'id' in payload && (payload as { id: unknown }).id === threadId) {
        refresh();
      }
    });
    return stop;
  }, [refresh, threadId]);

  if (items.length === 0) return null;
  return (
    <section className="thread-queued-ghosts" data-testid="thread-queued-messages">
      {paused ? (
        <header className="thread-queued-ghosts-header">
          <span className="thread-queued-card-paused" data-testid="thread-queued-paused">Paused after stop</span>
          <button
            type="button"
            className="thread-queued-flush"
            data-testid="thread-queued-send-now"
            aria-busy={flushing}
            disabled={flushing || sendingId !== null || deletingId !== null}
            onClick={() => {
              if (flushing || sendingId || deletingId) return;
              setFlushing(true);
              setFlushError(null);
              void product.threads.flushNextTurn(threadId, true)
                .then(refresh)
                .catch((err) => {
                  setFlushError(err instanceof Error ? err.message : 'Failed to send queued messages');
                })
                .finally(() => setFlushing(false));
            }}
          >
            <Send size={12} aria-hidden="true" />
            Send all
          </button>
        </header>
      ) : null}
      {flushError ? (
        <p role="alert" className="thread-queued-failure" data-testid="thread-queued-flush-error">{flushError}</p>
      ) : null}
      <ul className="thread-queued-list">
        {items.map((item) => (
          <li key={item.id} className="thread-queued-ghost" data-status={item.status}>
            <div className="thread-queued-ghost-body">
              <p className="thread-queued-item-text">{queuedMessagePreview(item.text) || '(queued message)'}</p>
              {item.senderThreadId ? (
                <p className="thread-queued-sender" data-testid="thread-queued-sender">
                  From {item.senderThreadId}
                </p>
              ) : null}
              {item.status === 'dispatching' ? <p role="status">Sending…</p> : null}
              {item.retryAt && !paused ? <p data-testid="thread-queued-retry">Retry scheduled for {new Date(item.retryAt).toLocaleTimeString()}</p> : null}
              {item.failureReason ? (
                <p className="thread-queued-failure" data-testid="thread-queued-failure">{item.failureReason}</p>
              ) : null}
            </div>
            <button
              type="button"
              className="thread-queued-flush"
              data-testid="thread-queued-item-send-now"
              aria-busy={sendingId === item.id}
              disabled={flushing || sendingId !== null || deletingId !== null || item.status === 'dispatching'}
               onClick={() => {
                setSendingId(item.id);
                setFlushError(null);
                void product.threads.sendNextTurn(threadId, item.id)
                  .then(() => {
                    setItems((current) => current.filter((row) => row.id !== item.id));
                    refresh();
                  })
                  .catch((err) => {
                    setFlushError(err instanceof Error ? err.message : 'Failed to send queued message');
                    refresh();
                  })
                  .finally(() => setSendingId(null));
              }}
            >
              <Send size={12} aria-hidden="true" />
              {sendingId === item.id ? 'Sending…' : 'Send now'}
            </button>
            <button
              type="button"
              className="thread-queued-ghost-stop"
              data-testid="thread-queued-delete"
              aria-label="Remove queued message"
              title="Remove queued message"
              disabled={flushing || sendingId !== null || deletingId !== null || item.status === 'dispatching'}
              onClick={() => {
                if (flushing || sendingId || deletingId) return;
                setDeletingId(item.id);
                setFlushError(null);
                void product.threads.deleteNextTurn(threadId, item.id)
                  .then(() => {
                    setItems((current) => current.filter((row) => row.id !== item.id));
                    refresh();
                  })
                  .catch((err) => {
                    setFlushError(err instanceof Error ? err.message : 'Failed to remove queued message');
                  })
                  .finally(() => setDeletingId(null));
              }}
            >
              <Square size={14} fill="currentColor" aria-hidden="true" />
            </button>
           </li>
         ))}
       </ul>
     </section>
  );
}

export function ModelFallbackCard({ fallback }: { fallback: ThreadTimelineModelFallback | null | undefined }) {
  if (!fallback) return null;
  return (
    <section className="thread-composer-stack-card" data-testid="thread-model-fallback">
      <strong>Model fallback</strong>
      <p>{fallback.originalModel} → {fallback.fallbackModel}</p>
      <p className="thread-banner-meta">{fallback.message}</p>
    </section>
  );
}

function backgroundActivityKind(row: TimelineViewWorkflowWorkRow): 'workflow' | 'agent' | 'command' {
  if (row.taskType === LOCAL_WORKFLOW_TASK_TYPE) return 'workflow';
  if (isBackgroundAgentTaskType(row.taskType)) return 'agent';
  return 'command';
}

function backgroundActivityTitle(rows: TimelineViewWorkflowWorkRow[]): string {
  const kinds = new Set(rows.map(backgroundActivityKind));
  if (kinds.size !== 1) return 'Background activity';
  if (kinds.has('workflow')) return rows.length === 1 ? 'Workflow' : 'Workflows';
  if (kinds.has('agent')) return rows.length === 1 ? 'Background agent' : 'Background agents';
  return rows.length === 1 ? 'Background command' : 'Background commands';
}

function backgroundActivityKindLabel(kind: BackgroundActivityKind): string {
  switch (kind) {
    case 'workflow':
      return 'Workflow';
    case 'agent':
      return 'Background agent';
    case 'command':
      return 'Background command';
  }
}

type BackgroundActivityKind = ReturnType<typeof backgroundActivityKind>;

const BACKGROUND_ACTIVITY_ICONS = {
  workflow: Workflow,
  agent: Sparkles,
  command: SquareTerminal
} as const;

const BACKGROUND_ACTIVITY_TICK_MS = 1000;

/** One shared clock for every row's elapsed label. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), BACKGROUND_ACTIVITY_TICK_MS);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function BackgroundActivityRow({ row, now }: { row: TimelineViewWorkflowWorkRow; now: number }) {
  const kind = backgroundActivityKind(row);
  const Icon = BACKGROUND_ACTIVITY_ICONS[kind];
  const kindLabel = backgroundActivityKindLabel(kind);
  const text = row.workflowName || row.description || 'Running';
  const elapsed = formatWorkingElapsed(now - row.startedAt);
  const line = (
    <>
      <span className="thread-background-activity-icon" title={kindLabel}>
        <Icon size={13} aria-hidden="true" />
        <span className="sr-only">{kindLabel}: </span>
      </span>
      <span className={`thread-background-activity-text${kind === 'command' ? ' is-command' : ''}`}>{text}</span>
      {kind === 'agent' && row.model ? <span className="thread-background-activity-badge">{row.model}</span> : null}
      <Loader2 size={12} className="spin thread-background-activity-spinner" aria-hidden="true" />
      {elapsed ? <span className="thread-background-activity-elapsed">{elapsed}</span> : null}
    </>
  );
  if (kind !== 'command') {
    return (
      <li className="thread-background-activity-item" data-kind={kind}>
        <div className="thread-background-activity-row">{line}</div>
      </li>
    );
  }
  return (
    <li className="thread-background-activity-item" data-kind={kind}>
      <details>
        <summary className="thread-background-activity-row" title="Show full command">{line}</summary>
        <pre className="thread-background-activity-full" data-testid="thread-background-command-full">{text}</pre>
      </details>
    </li>
  );
}

export function BackgroundCommandsCard({
  commands,
  workflows
}: {
  commands: TimelineViewWorkflowWorkRow[] | null | undefined;
  workflows?: TimelineViewWorkflowWorkRow[] | null;
}) {
  const rows = [...(workflows ?? []), ...(commands ?? [])];
  const now = useNow(rows.length > 0);
  if (rows.length === 0) return null;
  return (
    <section
      className="thread-composer-stack-card thread-background-commands-card"
      data-testid="thread-background-commands"
    >
      <header className="thread-queued-card-header">
        <span className="thread-stack-card-title">{backgroundActivityTitle(rows)}</span>
        {rows.length > 1 ? <span className="thread-background-activity-count">{rows.length} running</span> : null}
      </header>
      <ul className="thread-background-activity-list">
        {rows.map((row) => <BackgroundActivityRow key={row.id} row={row} now={now} />)}
      </ul>
    </section>
  );
}

const PROMPT_CONTEXT_POLL_MS = 3_000;

export function PromptContextBanner({
  threadId,
  branchName,
  isWorktree,
  parentThreadId,
  originKind,
  childCount,
  environmentId
}: {
  threadId?: string;
  branchName?: string | null;
  isWorktree?: boolean;
  parentThreadId?: string | null;
  originKind?: string | null;
  childCount?: number;
  environmentId?: string | null;
}) {
  const [pullRequest, setPullRequest] = useState<GitHostPullRequest | null>(null);

  useEffect(() => {
    if (!environmentId) {
      setPullRequest(null);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void loadWorkspaceMeta(
        product.environments.status,
        product.environments.pullRequest,
        environmentId
      ).then(({ pullRequest: nextPr }) => {
        if (cancelled) return;
        setPullRequest((nextPr as GitHostPullRequest | null) ?? null);
      });
    };
    refresh();
    const timer = window.setInterval(refresh, PROMPT_CONTEXT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [environmentId]);

  const bits = [
    branchName ? `git: ${branchName}` : null,
    isWorktree ? 'worktree' : null,
    originKind === 'fork' ? 'fork' : parentThreadId ? 'child thread' : null,
    childCount && childCount > 0 ? `${childCount} child ${childCount === 1 ? 'agent' : 'agents'}` : null
  ].filter(Boolean);
  if (bits.length === 0 && !pullRequest) return null;
  return (
    <div className="thread-composer-stack-card thread-prompt-context" data-testid="thread-prompt-context">
      {bits.length > 0 ? <span>{bits.join(' · ')}</span> : null}
      {pullRequest ? (
        <a
          className="thread-prompt-context-pr"
          href={pullRequest.url}
          target="_blank"
          rel="noreferrer"
            onClick={(event) => {
              if (event.shiftKey || event.altKey) return;
              if (handleHttpLinkClick(pullRequest.url, { event, ownerId: threadId })) event.preventDefault();
            }}
        >
          PR #{pullRequest.number}
        </a>
      ) : null}
    </div>
  );
}
