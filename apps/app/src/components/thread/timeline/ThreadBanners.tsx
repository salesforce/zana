import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import type { ActiveThinking, ThreadTimelineGoal, ThreadTimelinePendingTodos } from '@zana-ai/zcc-domain/thread-runtime';
import type { TimelineViewWorkflowWorkRow } from '@zana-ai/zcc-thread-view';
import { isBusyThreadStatus, threadStatusLabel, threadStatusTone, visiblePendingTodos } from '../thread-timeline-model.js';

export function ThreadTodoCard({ todos }: { todos: ThreadTimelinePendingTodos | null }) {
  const visible = visiblePendingTodos(todos);
  if (!visible) return null;
  const done = visible.items.filter((item) => item.status === 'completed').length;
  return (
    <section className="thread-todo-card" data-testid="thread-todos">
      <h2>{done}/{visible.items.length} complete</h2>
      <ul>
        {[...visible.items]
          .sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed'))
          .map((item) => (
            <li key={item.id} data-status={item.status}>{item.text}</li>
          ))}
      </ul>
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
  if (waitingOnUser || (!isBusyThreadStatus(status) && !thinking)) return null;
  const isThinking = thinking != null;
  const details = thinking?.text?.trim() ?? '';
  const label = isThinking ? 'Thinking…' : 'Working…';
  if (details) {
    return (
      <details className="thread-working-indicator" data-testid="thread-thinking">
        <summary className="thread-working-indicator-header">
          <ChevronRight size={12} className="thread-timeline-work-chevron" aria-hidden="true" />
          <span className="is-shimmer">{label}</span>
        </summary>
        <pre className="thread-thinking-details">{details}</pre>
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

export function ThreadPromptModeChip({
  mode
}: {
  mode: { mode: string; prompt?: string } | null | undefined;
}) {
  if (!mode) return null;
  return (
    <span className="thread-chip" data-testid="thread-prompt-mode">
      {mode.mode}
      {mode.prompt ? ` · ${mode.prompt}` : ''}
    </span>
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
  const label = threadStatusLabel(status, waitingOnUser, thinking);
  if (!label) return null;
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
  status,
  waitingOnUser,
  thinking,
  overflow
}: {
  title: string;
  status: string;
  waitingOnUser?: boolean;
  thinking?: ActiveThinking | null;
  overflow?: ReactNode;
}) {
  return (
    <div className="thread-detail-heading">
      <h1>{title}</h1>
      {overflow}
      <ThreadStatusBadge status={status} waitingOnUser={waitingOnUser} thinking={thinking} />
    </div>
  );
}
