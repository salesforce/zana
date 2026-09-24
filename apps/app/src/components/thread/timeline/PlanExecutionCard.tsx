import { useState } from 'react';
import { ChevronDown, ChevronRight, Circle, CircleAlert, CircleCheck, CircleDot } from 'lucide-react';
import {
  planCompletedCount,
  planExecutionCurrentIndex,
  planTaskStatusLabel,
  planTaskVisual,
  type PlanExecutionTask
} from './plan-execution-card.js';

function PlanTaskGlyph({ status }: { status: string }) {
  const props = { size: 14, className: 'thread-plan-execution-glyph', 'aria-hidden': true as const };
  switch (planTaskVisual(status)) {
    case 'completed':
      return <CircleCheck {...props} />;
    case 'in_progress':
      return <CircleDot {...props} />;
    case 'blocked':
      return <CircleAlert {...props} />;
    default:
      return <Circle {...props} />;
  }
}

export function PlanExecutionCard({
  title,
  tasks
}: {
  title: string;
  tasks: readonly PlanExecutionTask[];
}) {
  const [expanded, setExpanded] = useState(true);
  if (tasks.length === 0) return null;
  const currentIndex = planExecutionCurrentIndex(tasks);
  const current = tasks[currentIndex];
  if (!current) return null;
  const completed = planCompletedCount(tasks);
  // The header names the plan (falling back to the active task) and shows how
  // many steps are done; the body lists every step with its own status glyph,
  // so a finished step reads as done instead of repeating the current task.
  const heading = title.trim() || current.text;
  return (
    <section
      className="thread-plan-execution"
      data-testid="thread-plan-execution"
      aria-label={heading}
    >
      <button
        type="button"
        className="thread-plan-execution-header"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded
          ? <ChevronDown size={12} className="thread-timeline-work-chevron" aria-hidden="true" />
          : <ChevronRight size={12} className="thread-timeline-work-chevron" aria-hidden="true" />}
        <span className="thread-plan-execution-title">{heading}</span>
        <span
          className="thread-plan-execution-count"
          data-testid="thread-plan-execution-count"
          aria-label={`${completed} of ${tasks.length} done`}
        >
          {completed}/{tasks.length}
        </span>
      </button>
      {expanded ? (
        <div className="thread-plan-execution-body">
          <ol className="thread-plan-execution-list">
            {tasks.map((task, index) => {
              const visual = planTaskVisual(task.status);
              const isCurrent = index === currentIndex;
              return (
                <li
                  key={task.id}
                  className={[
                    'thread-plan-execution-item',
                    visual === 'completed' ? 'is-done' : '',
                    isCurrent ? 'is-current' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-status={task.status}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-label={`${planTaskStatusLabel(task.status)}: ${task.text}`}
                >
                  <PlanTaskGlyph status={task.status} />
                  <span className="thread-plan-execution-item-text">{task.text}</span>
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
