import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Kanban, KanbanColumn } from '@zana-ai/zcc-ui/kanban';
import {
  groupColumns,
  PRIORITY_LABELS,
  STATUS_LABELS,
  visibleBoardStatuses,
  type PublicTask,
  type TaskStatus
} from '../model.js';
import { EmptyState } from './empty-state.js';
import { PriorityIcon, StatusIcon } from './icons.js';

export function BoardView({
  items,
  error,
  onOpen,
  onMove,
  onNew
}: {
  items: PublicTask[] | undefined;
  error: string | null;
  onOpen: (task: PublicTask) => void;
  onMove: (task: PublicTask, status: TaskStatus, index: number) => void;
  onNew: (status: TaskStatus) => void;
}) {
  const [draggingId, setDraggingId] = useState<string | null>(null);

  if (items === undefined) {
    return (
      <div className="tsk-board-skeleton" aria-hidden>
        {Array.from({ length: 5 }, (_, index) => (
          <div key={index} className="tsk-board-skel-col" />
        ))}
      </div>
    );
  }
  if (error && items.length === 0) {
    return <EmptyState title="Couldn't load tasks" description={error} />;
  }
  if (items.length === 0) {
    return (
      <EmptyState
        title="No tasks yet"
        description="Create the first task to start tracking work."
        action={
          <button type="button" className="tsk-btn tsk-btn-primary" onClick={() => onNew('todo')}>
            <Plus size={14} />
            New task
          </button>
        }
      />
    );
  }

  const columns = groupColumns(items);
  return (
    <Kanban label="Tasks by status" columnWidth={240} className="tsk-board">
      {visibleBoardStatuses(columns).map((status) => {
        const cards = columns[status];
        return (
          <KanbanColumn
            key={status}
            columnId={status}
            label={STATUS_LABELS[status]}
            count={cards.length}
            icon={<StatusIcon status={status} />}
          >
            <div
              className="tsk-col-drop"
              data-drop-status={status}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData('text/task-id');
                const task = items.find((item) => item.id === id);
                if (!task) return;
                const cardNodes = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-task-id]')];
                const index = cardNodes.findIndex((node) => {
                  const rect = node.getBoundingClientRect();
                  return event.clientY < rect.top + rect.height / 2;
                });
                onMove(task, status, index === -1 ? cards.length : index);
                setDraggingId(null);
              }}
            >
              {cards.map((task) => (
                <article
                  key={task.id}
                  data-task-id={task.id}
                  data-task-key={task.key}
                  draggable
                  className={`tsk-card ${draggingId === task.id ? 'is-dragging' : ''}`}
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/task-id', task.id);
                    event.dataTransfer.effectAllowed = 'move';
                    setDraggingId(task.id);
                  }}
                  onDragEnd={() => setDraggingId(null)}
                  onClick={() => onOpen(task)}
                >
                  <div className="tsk-card-meta">
                    <span className="tsk-card-key">{task.key}</span>
                  </div>
                  <div className="tsk-card-title">{task.title}</div>
                  <div className="tsk-card-foot">
                    <span title={PRIORITY_LABELS[task.priority]}>
                      <PriorityIcon priority={task.priority} />
                    </span>
                  </div>
                </article>
              ))}
              <button type="button" className="tsk-col-add" onClick={() => onNew(status)}>
                <Plus size={12} />
                Add
              </button>
            </div>
          </KanbanColumn>
        );
      })}
    </Kanban>
  );
}
