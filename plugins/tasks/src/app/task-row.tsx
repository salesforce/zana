import { Clock } from 'lucide-react';
import {
  formatDueDate,
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type PublicTask,
  type TaskPriority,
  type TaskStatus
} from '../model.js';
import { PriorityIcon, StatusIcon } from './icons.js';
import { ChipButton, MenuItem } from './menu.js';

export function PropertyMenu({
  task,
  kind,
  onEdit
}: {
  task: PublicTask;
  kind: 'status' | 'priority';
  onEdit: (patch: { status?: TaskStatus; priority?: TaskPriority }) => void;
}) {
  if (kind === 'status') {
    return (
      <ChipButton
        variant="ghost"
        ariaLabel={`Status: ${STATUS_LABELS[task.status]}`}
        icon={<StatusIcon status={task.status} />}
      >
        {(close) => (
          <>
            {TASK_STATUSES.map((status) => (
              <MenuItem
                key={status}
                icon={<StatusIcon status={status} />}
                checked={task.status === status}
                onSelect={() => {
                  onEdit({ status });
                  close();
                }}
              >
                {STATUS_LABELS[status]}
              </MenuItem>
            ))}
          </>
        )}
      </ChipButton>
    );
  }
  return (
    <ChipButton
      variant="ghost"
      ariaLabel={`Priority: ${PRIORITY_LABELS[task.priority]}`}
      icon={<PriorityIcon priority={task.priority} />}
    >
      {(close) => (
        <>
          {TASK_PRIORITIES.map((priority) => (
            <MenuItem
              key={priority}
              icon={<PriorityIcon priority={priority} />}
              checked={task.priority === priority}
              onSelect={() => {
                onEdit({ priority });
                close();
              }}
            >
              {PRIORITY_LABELS[priority]}
            </MenuItem>
          ))}
        </>
      )}
    </ChipButton>
  );
}

export function TaskRow({
  task,
  onOpen,
  onEdit
}: {
  task: PublicTask;
  onOpen: () => void;
  onEdit: (patch: { status?: TaskStatus; priority?: TaskPriority }) => void;
}) {
  return (
    <div className="tsk-row" data-task-key={task.key}>
      <button
        type="button"
        className="tsk-row-hit"
        aria-label={`Open ${task.key}: ${task.title}`}
        onClick={onOpen}
      />
      <div className="tsk-row-priority">
        <PropertyMenu task={task} kind="priority" onEdit={onEdit} />
      </div>
      <span className="tsk-row-key">{task.key}</span>
      <div className="tsk-row-status">
        <PropertyMenu task={task} kind="status" onEdit={onEdit} />
      </div>
      <span className="tsk-row-title">{task.title}</span>
      {task.dueDate ? (
        <span className="tsk-row-due">
          <Clock size={12} aria-hidden />
          {formatDueDate(task.dueDate)}
        </span>
      ) : null}
    </div>
  );
}
