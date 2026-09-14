import { useEffect, useState } from 'react';
import { Clock, Trash2 } from 'lucide-react';
import {
  formatDueDate,
  PRIORITY_LABELS,
  STATUS_LABELS,
  type PublicTask,
  type TaskPriority,
  type TaskStatus
} from '../model.js';
import { PropertyMenu } from './task-row.js';

export function DetailView({
  task,
  error,
  onPatch,
  onRemove
}: {
  task: PublicTask | undefined;
  error: string | null;
  onPatch: (patch: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    priority?: TaskPriority;
    dueDate?: string | null;
  }) => void;
  onRemove: () => void;
}) {
  const [description, setDescription] = useState(task?.description ?? '');
  useEffect(() => {
    setDescription(task?.description ?? '');
  }, [task?.id, task?.description]);

  if (error && !task) {
    return (
      <div className="tsk-detail">
        <p className="tsk-empty-desc">{error}</p>
      </div>
    );
  }
  if (!task) {
    return (
      <div className="tsk-detail">
        <div className="tsk-skeleton-row" />
        <div className="tsk-skeleton-row" />
      </div>
    );
  }

  return (
    <div className="tsk-detail">
      <div className="tsk-detail-props">
        <PropertyMenu task={task} kind="status" onEdit={(patch) => onPatch(patch)} />
        <span className="tsk-detail-status">{STATUS_LABELS[task.status]}</span>
        <PropertyMenu task={task} kind="priority" onEdit={(patch) => onPatch(patch)} />
        <span className="tsk-detail-status">{PRIORITY_LABELS[task.priority]}</span>
        <label className="tsk-due-field">
          <Clock size={12} />
          <input
            type="date"
            aria-label="Due date"
            value={task.dueDate ?? ''}
            onChange={(event) => onPatch({ dueDate: event.target.value || null })}
          />
          {task.dueDate ? <span>{formatDueDate(task.dueDate)}</span> : <span>Due date</span>}
        </label>
      </div>
      <h1
        className="tsk-detail-title"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Task title"
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => {
          const next = event.currentTarget.textContent?.trim() ?? '';
          if (!next) {
            event.currentTarget.textContent = task.title;
            return;
          }
          if (next !== task.title) onPatch({ title: next });
        }}
      >
        {task.title}
      </h1>
      <textarea
        className="tsk-detail-body"
        aria-label="Task description"
        placeholder="Add a description…"
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        onBlur={() => {
          if (description !== task.description) onPatch({ description });
        }}
      />
      <button type="button" className="tsk-btn tsk-btn-danger" onClick={onRemove}>
        <Trash2 size={14} />
        Delete task
      </button>
    </div>
  );
}
