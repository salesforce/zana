import { Circle, CircleAlert, CircleCheck, CircleDot } from 'lucide-react';

export type ThreadTodoChecklistItem = {
  id: string;
  text: string;
  status: string;
  blockedReason?: string | null;
};

function TodoStatusGlyph({ status }: { status: string }) {
  const props = { size: 14, className: 'thread-todo-checklist-glyph', 'aria-hidden': true as const };
  if (status === 'completed') return <CircleCheck {...props} />;
  if (status === 'in_progress' || status === 'active') return <CircleDot {...props} />;
  if (status === 'blocked') return <CircleAlert {...props} />;
  return <Circle {...props} />;
}

function statusLabel(status: string): string {
  if (status === 'completed') return 'Completed';
  if (status === 'in_progress' || status === 'active') return 'In progress';
  if (status === 'blocked') return 'Blocked';
  if (status === 'cancelled' || status === 'canceled') return 'Cancelled';
  return 'Pending';
}

export function ThreadTodoChecklist({
  items,
  testId
}: {
  items: readonly ThreadTodoChecklistItem[];
  testId?: string;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="thread-todo-checklist" data-testid={testId}>
      {items.map((item) => (
        <li
          key={item.id}
          className="thread-todo-checklist-item"
          data-status={item.status}
          aria-label={`${statusLabel(item.status)}: ${item.text}`}
        >
          <TodoStatusGlyph status={item.status} />
          <span className="thread-todo-checklist-text">
            {item.text}
            {item.blockedReason ? ` (${item.blockedReason})` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
