import { type PointerEvent, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ListTodo, Loader2, X } from 'lucide-react';
import type {
  ActiveThinking,
  ThreadTimelineGoal,
  ThreadTimelinePendingTodoItemStatus,
  ThreadTimelinePendingTodos
} from '@zana-ai/zcc-domain/thread-runtime';
import type { TimelineViewWorkflowWorkRow } from '@zana-ai/zcc-thread-view';
import {
  isBusyThreadStatus,
  threadStatusLabel,
  threadStatusTone,
  threadWorkingIndicatorLabel
} from '../thread-timeline-model.js';
import { useThreadWorkingPhrase } from '../useThreadWorkingPhrase.js';

const TODO_STATUS_SORT_RANK: Record<ThreadTimelinePendingTodoItemStatus, number> = {
  in_progress: 0,
  pending: 1,
  completed: 2
};

export function ThreadTodoCard({
  todos,
  isExpanded,
  onToggle
}: {
  todos: ThreadTimelinePendingTodos | null;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const items = todos?.items ?? [];
  if (items.length === 0) return null;
  const done = items.filter((item) => item.status === 'completed').length;
  const ordered = [...items].sort(
    (a, b) => TODO_STATUS_SORT_RANK[a.status] - TODO_STATUS_SORT_RANK[b.status]
  );
  return (
    <section className="thread-composer-stack-card thread-todo-card" data-testid="thread-todos">
      <button
        type="button"
        className="thread-stack-card-toggle"
        aria-expanded={isExpanded}
        aria-controls="thread-todo-card-body"
        aria-label={`To-do list: ${done} of ${items.length} ${items.length === 1 ? 'item' : 'items'} complete`}
        onClick={onToggle}
      >
        <ListTodo size={14} aria-hidden="true" />
        <span className="thread-stack-card-title">{done}/{items.length} complete</span>
        <ChevronDown
          size={14}
          aria-hidden="true"
          className={`thread-stack-card-chevron${isExpanded ? ' is-open' : ''}`}
        />
      </button>
      <div
        id="thread-todo-card-body"
        hidden={!isExpanded}
        className="thread-stack-card-body"
      >
        <ul>
          {ordered.map((item) => (
            <li key={item.id} data-status={item.status}>{item.text}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function ThreadPromptModeCard({
  mode,
  isExpanded,
  isExitPending = false,
  onToggle,
  onExitPlanMode
}: {
  mode: { mode: string; prompt?: string } | null | undefined;
  isExpanded: boolean;
  isExitPending?: boolean;
  onToggle: () => void;
  onExitPlanMode?: () => void;
}) {
  if (mode?.mode !== 'plan') return null;
  const promptText = mode.prompt?.trim() ?? '';
  return (
    <section
      className="thread-composer-stack-card thread-prompt-mode-card"
      data-testid="thread-prompt-mode"
    >
      <div className="thread-stack-card-header" role="group" aria-label="Plan mode controls">
        <button
          type="button"
          className="thread-stack-card-toggle"
          aria-expanded={isExpanded}
          aria-controls="thread-prompt-mode-card-body"
          aria-label="Plan"
          onClick={onToggle}
        >
          <ListTodo size={14} aria-hidden="true" />
          <span className="thread-stack-card-title">Plan</span>
          <ChevronDown
            size={14}
            aria-hidden="true"
            className={`thread-stack-card-chevron${isExpanded ? ' is-open' : ''}`}
          />
        </button>
        {onExitPlanMode ? (
          <button
            type="button"
            className="thread-stack-card-exit"
            aria-label="Exit plan mode"
            data-testid="thread-exit-plan"
            disabled={isExitPending}
            onClick={onExitPlanMode}
          >
            {isExitPending ? (
              <Loader2 size={14} className="spin" aria-hidden="true" />
            ) : (
              <X size={14} aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>
      <div
        id="thread-prompt-mode-card-body"
        hidden={!isExpanded}
        className="thread-stack-card-body"
      >
        <p className="thread-prompt-mode-prompt">
          {promptText.length > 0 ? promptText : 'No prompt text.'}
        </p>
      </div>
    </section>
  );
}

export function ThreadWorkingIndicator({
  status,
  thinking,
  waitingOnUser
}: {
  status: string;
  thinking: ActiveThinking | null;
  waitingOnUser?: boolean;
}) {
  const isThinking = thinking != null;
  const visible = !waitingOnUser && (isBusyThreadStatus(status) || isThinking);
  // Keep the working phrase for the whole busy stretch. Thinking… is a label
  // swap (BB: Working... / Thinking...), not a new working display.
  const phrase = useThreadWorkingPhrase(visible);
  if (!visible) return null;
  const details = thinking?.text?.trim() ?? '';
  const label = threadWorkingIndicatorLabel(isThinking, phrase);
  if (details) {
    return (
      <details className="thread-working-indicator" data-testid="thread-thinking">
        <summary className="thread-working-indicator-header">
          <ChevronRight size={12} className="thread-timeline-work-chevron" aria-hidden="true" />
          <span className="is-shimmer">{label}</span>
        </summary>
        <div className="thread-thinking-details">{details}</div>
      </details>
    );
  }
  return (
    <p className="thread-working-indicator thread-working-indicator-header is-shimmer" data-testid="thread-thinking">
      {label}
    </p>
  );
}

export function ThreadGoalBanner({ goal }: { goal: ThreadTimelineGoal | null | undefined }) {
  if (!goal?.objective) return null;
  return (
    <div className="thread-banner thread-goal-banner" data-testid="thread-goal">
      <strong>Goal</strong>
      <span>{goal.objective}</span>
      <span className="thread-banner-meta">{goal.status}</span>
    </div>
  );
}

export function ThreadWorkflowChips({
  workflows
}: {
  workflows: TimelineViewWorkflowWorkRow[] | null | undefined;
}) {
  if (!workflows?.length) return null;
  return (
    <div className="thread-banner-row" data-testid="thread-workflows">
      {workflows.map((workflow) => (
        <span key={workflow.id} className="thread-chip">
          {workflow.workflowName || workflow.description || 'Workflow'}
        </span>
      ))}
    </div>
  );
}

export function ThreadStatusBadge({
  status,
  waitingOnUser,
  thinking
}: {
  status: string;
  waitingOnUser?: boolean;
  thinking?: ActiveThinking | null;
}) {
  const label = threadStatusLabel(status, waitingOnUser, thinking, 'Working');
  // Idle is the resting state — the list already shows it. Keep the header
  // chip for states that ask for attention or show work in flight.
  if (!label || label === 'Idle') return null;
  const tone = threadStatusTone(status, waitingOnUser);
  return (
    <span
      className={`thread-chip thread-status-badge is-${tone}`}
      data-testid="thread-detail-status"
      data-status={status}
    >
      <span className={`tab-agent-dot agent-${tone}`} aria-hidden="true" />
      {label}
    </span>
  );
}

export function ThreadDetailHeading({
  title,
  overflow,
  onPointerDown,
  draggable
}: {
  title: string;
  overflow?: ReactNode;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
  draggable?: boolean;
}) {
  return (
    <div
      className={`thread-detail-heading${draggable ? ' split-pane-drag-handle' : ''}`}
      onPointerDown={onPointerDown}
    >
      <h1 title={title}>{title}</h1>
      {overflow}
    </div>
  );
}
