import { useState } from 'react';
import { ChevronDown, ChevronRight, Circle } from 'lucide-react';
import {
  planExecutionCurrentIndex,
  type PlanExecutionTask
} from './plan-execution-card.js';

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
  const remaining = tasks.filter((_, index) => index !== currentIndex);
  return (
    <section
      className="thread-plan-execution"
      data-testid="thread-plan-execution"
      aria-label={title}
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
        <span className="thread-plan-execution-title">{current.text}</span>
        <span className="thread-plan-execution-count" data-testid="thread-plan-execution-count">
          {currentIndex + 1}/{tasks.length}
        </span>
      </button>
      {expanded ? (
        <div className="thread-plan-execution-body">
          <p className="thread-plan-execution-current" data-testid="thread-plan-execution-current">
            {current.text}
          </p>
          {remaining.length > 0 ? (
            <ol className="thread-plan-execution-list">
              {remaining.map((task) => {
                const done = task.status === 'completed';
                return (
                  <li
                    key={task.id}
                    className={`thread-plan-execution-item${done ? ' is-done' : ''}`}
                    data-status={task.status}
                  >
                    <Circle size={14} aria-hidden="true" className="thread-plan-execution-glyph" />
                    <span className="thread-plan-execution-item-text">{task.text}</span>
                  </li>
                );
              })}
            </ol>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
