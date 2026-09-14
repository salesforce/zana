import { ListTodo } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
  title,
  description,
  action
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="tsk-empty">
      <div className="tsk-empty-icon" aria-hidden>
        <ListTodo size={20} />
      </div>
      <div className="tsk-empty-copy">
        <p className="tsk-empty-title">{title}</p>
        {description ? <p className="tsk-empty-desc">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}
