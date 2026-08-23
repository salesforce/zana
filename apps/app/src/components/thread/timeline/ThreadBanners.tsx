import type { ActiveThinking, ThreadTimelineGoal, ThreadTimelinePendingTodos } from '@zana-ai/zcc-domain/thread-runtime';
import type { TimelineViewWorkflowWorkRow } from '@zana-ai/zcc-thread-view';
import { isBusyThreadStatus, threadStatusLabel, threadStatusToAgentState, visiblePendingTodos } from '../thread-timeline-model.js';

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
  thinking
}: {
  status: string;
  thinking: ActiveThinking | null;
}) {
  if (!isBusyThreadStatus(status) && !thinking) return null;
  const details = thinking?.text?.trim() ?? '';
  const label = details || (thinking ? 'Thinking…' : 'Working…');
  if (details) {
    return (
      <details className="thread-working-indicator" data-testid="thread-thinking">
        <summary className="is-shimmer">{thinking ? 'Thinking…' : 'Working…'}</summary>
        <pre className="thread-thinking-details">{details}</pre>
      </details>
    );
  }
  return (
    <p className="thread-working-indicator is-shimmer" data-testid="thread-thinking">
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

export function ThreadStatusBadge({ status }: { status: string }) {
  const label = threadStatusLabel(status);
  if (!label) return null;
  const state = threadStatusToAgentState(status);
  return (
    <span
      className={`thread-chip thread-status-badge is-${state}`}
      data-testid="thread-detail-status"
      data-status={status}
    >
      <span className={`tab-agent-dot agent-${state}`} aria-hidden="true" />
      {label}
    </span>
  );
}
