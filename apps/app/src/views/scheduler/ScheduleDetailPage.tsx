import { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Maximize2, Minimize2, X } from 'lucide-react';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';
import { product } from '../../lib/product-client.js';
import { useScheduler, useUi } from '../../store.js';
import { getNewScheduleRoutePath, getScheduleRoutePath, getSchedulerRoutePath, getProjectModeRoutePath } from '../../lib/route-paths.js';
import { useOptionalPaneContext } from '../thread-detail/PaneContext.js';
import { ScheduleEditor } from '../../components/scheduler/ScheduleEditor.js';
import { ScheduleInfoPanel } from '../../components/scheduler/ScheduleInfoPanel.js';
import { DeleteConfirmModal } from '../../components/scheduler/DeleteConfirmModal.js';
import { scheduleSeedFromLocationState, type ScheduleSeed } from '../../components/scheduler/schedule-seed.js';
import { PaneEmptyState } from '../../components/PaneEmptyState.js';

/**
 * Schedule editor as a first-class page (same as a thread). In a split pane it
 * fills that pane so the catalogue can sit beside it; otherwise Close returns
 * to the catalogue.
 */
export function ScheduleDetailPage({
  projectId,
  scheduleId
}: {
  projectId: string | null;
  scheduleId: string | null;
}) {
  const location = useLocation();
  const seed = scheduleSeedFromLocationState(location.state);
  const tasks = useScheduler((s) => s.tasks);
  const loading = useScheduler((s) => s.loading);
  const task = useMemo(
    () => (scheduleId ? tasks.find((row) => row.id === scheduleId) ?? null : null),
    [scheduleId, tasks]
  );

  return (
    <ScheduleDetailView
      task={scheduleId && !task && !loading ? 'missing' : task}
      seed={scheduleId ? null : seed}
      projectId={projectId}
    />
  );
}

function ScheduleDetailView({
  task,
  seed,
  projectId
}: {
  task: ScheduledTask | null | 'missing';
  seed: ScheduleSeed | null;
  projectId: string | null;
}) {
  const navigate = useNavigate();
  const pane = useOptionalPaneContext();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const liveTask = task === 'missing' ? null : task;
  const isExternal = liveTask?.external?.kind === 'claude-loop';

  const title = liveTask?.name
    ?? (seed?.kind === 'template' ? `New schedule · ${seed.template.name}` : null)
    ?? (seed?.kind === 'duplicate' ? `Duplicate · ${seed.source.name}` : null)
    ?? (task === 'missing' ? 'Schedule unavailable' : 'New schedule');

  const cataloguePath = projectId
    ? getProjectModeRoutePath(projectId, 'scheduler')
    : getSchedulerRoutePath();

  const close = () => {
    if (pane?.isSplitPane && pane.onRequestClose) {
      pane.onRequestClose();
      return;
    }
    navigate(cataloguePath);
  };

  const onSaved = (scheduleId: string) => {
    navigate(getScheduleRoutePath(scheduleId, projectId), { replace: true });
  };

  const onDuplicate = liveTask
    ? () => {
        navigate(getNewScheduleRoutePath(projectId), {
          state: { seed: { kind: 'duplicate', source: liveTask } satisfies ScheduleSeed }
        });
      }
    : undefined;

  const body = task === 'missing' ? (
    <PaneEmptyState
      testId="schedule-missing"
      art="missing"
      title="This schedule is no longer available."
      hint="It was deleted or is no longer on this machine. You can close this pane."
    />
  ) : (
    <div className="schedule-detail-layout" data-testid="schedule-detail">
      <div className="schedule-detail-editor">
        <ScheduleEditor
          task={liveTask}
          seed={seed}
          lockedProjectId={projectId}
          readOnly={isExternal}
          onSaved={onSaved}
        />
      </div>
      <aside className="schedule-detail-info">
        <ScheduleInfoPanel
          task={liveTask}
          onDuplicate={onDuplicate}
          onAskDelete={liveTask ? () => setConfirmDelete(true) : undefined}
        />
      </aside>
    </div>
  );

  const confirm = confirmDelete && liveTask ? (
    <DeleteConfirmModal
      task={liveTask}
      onCancel={() => setConfirmDelete(false)}
      onConfirm={async () => {
        const id = liveTask.id;
        setConfirmDelete(false);
        const result = await product.scheduler.delete(id);
        if (!result.ok) {
          useUi.getState().pushToast(`Delete failed: ${result.message}`, 'error');
          return;
        }
        navigate(cataloguePath);
      }}
    />
  ) : null;

  return (
    <section className="schedule-detail-pane">
      <header className="schedule-detail-pane-header">
        <h1>{title}</h1>
        <div className="schedule-detail-pane-actions">
          {pane?.onToggleMaximize ? (
            <button
              type="button"
              className="icon-btn"
              title={pane.isMaximized ? 'Restore pane' : 'Maximize pane'}
              aria-label={pane.isMaximized ? 'Restore pane' : 'Maximize pane'}
              data-testid="split-pane-maximize"
              onClick={pane.onToggleMaximize}
            >
              {pane.isMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            title={pane?.isSplitPane ? 'Close pane' : 'Back to schedules'}
            aria-label={pane?.isSplitPane ? 'Close pane' : 'Back to schedules'}
            data-testid="split-pane-close"
            onClick={close}
          >
            <X size={14} />
          </button>
        </div>
      </header>
      {body}
      {confirm}
    </section>
  );
}
