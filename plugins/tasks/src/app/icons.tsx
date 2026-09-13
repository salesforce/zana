import type { TaskPriority, TaskStatus } from '../model.js';

const STATUS_COLOR: Record<TaskStatus, string> = {
  backlog: 'tsk-status-muted',
  todo: 'tsk-status-muted',
  in_progress: 'tsk-status-progress',
  in_review: 'tsk-status-review',
  done: 'tsk-status-done',
  canceled: 'tsk-status-muted'
};

export function StatusIcon({ status, className = '' }: { status: TaskStatus; className?: string }) {
  const ring = (dashed: boolean) => (
    <circle
      cx="7"
      cy="7"
      r="5.4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      {...(dashed ? { strokeDasharray: '1.8 2' } : {})}
    />
  );
  const disc = <circle cx="7" cy="7" r="6" fill="currentColor" />;
  return (
    <svg viewBox="0 0 14 14" aria-hidden className={`tsk-glyph ${STATUS_COLOR[status]} ${className}`.trim()}>
      {status === 'backlog' ? ring(true) : null}
      {status === 'todo' ? ring(false) : null}
      {status === 'in_progress' ? (
        <>
          {ring(false)}
          <path d="M7 7 L7 2.4 A4.6 4.6 0 0 1 11.2 9.5 Z" fill="currentColor" />
        </>
      ) : null}
      {status === 'in_review' ? (
        <>
          {ring(false)}
          <path d="M7 7 L7 2.4 A4.6 4.6 0 1 1 6.99 2.4 Z" fill="currentColor" />
        </>
      ) : null}
      {status === 'done' ? (
        <>
          {disc}
          <path
            d="M4.4 7.2 l1.8 1.8 3.4-3.8"
            fill="none"
            stroke="var(--bg-panel)"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      ) : null}
      {status === 'canceled' ? (
        <>
          {disc}
          <path
            d="M5 5 l4 4 M9 5 l-4 4"
            stroke="var(--bg-panel)"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </>
      ) : null}
    </svg>
  );
}

const ACTIVE_BARS: Record<Exclude<TaskPriority, 'urgent'>, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3
};

export function PriorityIcon({ priority, className = '' }: { priority: TaskPriority; className?: string }) {
  if (priority === 'urgent') {
    return (
      <svg viewBox="0 0 14 14" aria-hidden className={`tsk-glyph tsk-priority-urgent ${className}`.trim()}>
        <rect x="0.5" y="0.5" width="13" height="13" rx="3" fill="currentColor" />
        <rect x="6.2" y="3" width="1.6" height="5.2" rx="0.8" fill="var(--bg-panel)" />
        <circle cx="7" cy="10.6" r="1" fill="var(--bg-panel)" />
      </svg>
    );
  }
  const active = ACTIVE_BARS[priority];
  const bars = [
    { x: 1.5, y: 8, height: 5 },
    { x: 5.5, y: 5, height: 8 },
    { x: 9.5, y: 2, height: 11 }
  ];
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden
      className={`tsk-glyph ${priority === 'none' ? 'tsk-priority-none' : ''} ${className}`.trim()}
    >
      {bars.map((bar, index) => (
        <rect
          key={bar.x}
          x={bar.x}
          y={bar.y}
          width="3"
          height={bar.height}
          rx="1"
          className={index < active ? 'tsk-priority-on' : 'tsk-priority-off'}
        />
      ))}
    </svg>
  );
}
