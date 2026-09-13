import { useEffect, useRef, useState } from 'react';
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus
} from '../model.js';
import { PriorityIcon, StatusIcon } from './icons.js';

export interface NewTaskDraft {
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string;
}

export function NewTaskDialog({
  open,
  defaultStatus = 'todo',
  busy,
  error,
  onClose,
  onCreate
}: {
  open: boolean;
  defaultStatus?: TaskStatus;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onCreate: (draft: NewTaskDraft) => void;
}) {
  const [draft, setDraft] = useState<NewTaskDraft>({
    title: '',
    description: '',
    status: defaultStatus,
    priority: 'none',
    dueDate: ''
  });
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setDraft({ title: '', description: '', status: defaultStatus, priority: 'none', dueDate: '' });
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open, defaultStatus]);

  if (!open) return null;
  return (
    <div className="tsk-modal-root" role="presentation">
      <button type="button" className="tsk-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div className="tsk-modal" role="dialog" aria-labelledby="tsk-new-title" aria-modal="true">
        <h2 id="tsk-new-title">New task</h2>
        <p className="tsk-modal-lead">Create a task with a title, status, and optional due date.</p>
        <form
          className="tsk-modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!draft.title.trim() || busy) return;
            onCreate(draft);
          }}
        >
          <label className="tsk-field">
            Title
            <input
              ref={inputRef}
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="Ship the tracker"
              required
            />
          </label>
          <label className="tsk-field">
            Description
            <textarea
              value={draft.description}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              placeholder="What needs to happen?"
              rows={4}
            />
          </label>
          <div className="tsk-field-row">
            <label className="tsk-field">
              Status
              <select
                value={draft.status}
                onChange={(event) => setDraft({ ...draft, status: event.target.value as TaskStatus })}
              >
                {TASK_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
            <label className="tsk-field">
              Priority
              <select
                value={draft.priority}
                onChange={(event) => setDraft({ ...draft, priority: event.target.value as TaskPriority })}
              >
                {TASK_PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </select>
            </label>
            <label className="tsk-field">
              Due
              <input
                type="date"
                value={draft.dueDate}
                onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })}
              />
            </label>
          </div>
          <div className="tsk-status-preview" aria-hidden>
            <StatusIcon status={draft.status} />
            <PriorityIcon priority={draft.priority} />
          </div>
          {error ? <p className="tsk-form-error">{error}</p> : null}
          <div className="tsk-modal-actions">
            <button type="button" className="tsk-btn tsk-btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="tsk-btn tsk-btn-primary" disabled={busy || !draft.title.trim()}>
              Create task
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
