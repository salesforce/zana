import { product } from '../../lib/product-client.js';
import { DelayedStencilList } from '../../components/ui/Skeleton.js';
import React, { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Clock, Plus, Sparkles, Pause, PlayCircle, AlertTriangle, Activity, Settings } from 'lucide-react';
import type { ScheduledTask, ScheduleTemplate } from '@zana-ai/zcc-domain/product';
import { useData, useScheduler, useScheduleGroups, useUi } from '@/store';
import { EmptyStateWithFeatured } from '@/components/scheduler/EmptyStateWithFeatured';
import { openScheduledLive } from '@/components/scheduler/openScheduledLive';
import { ScheduleRow } from '@/components/scheduler/ScheduleRow';
import { DeleteConfirmModal } from '@/components/scheduler/DeleteConfirmModal';
import { TemplatePickerModal } from '@/components/scheduler/TemplatePickerModal';
import { SchedulerOverview } from '@/components/scheduler/SchedulerOverview';
import { ScheduleGroupsModal } from '@/components/ScheduleGroupsModal';
import { getNewScheduleRoutePath, getScheduleRoutePath } from '@/lib/route-paths';
import { openScheduleInSplit } from '@/lib/split-layout/openThreadInSplit';
import { isCompactViewport } from '@/hooks/useIsCompactViewport';
import type { ScheduleSeed } from '@/components/scheduler/schedule-seed';

export { pickLiveRun } from '@/components/scheduler/schedulerUtils';

/**
 * The Scheduler catalogue. Mounted two ways:
 * - Cross-project (top-level nav, no props): every schedule, Overview first.
 * - Project-locked (`projectId` set — the per-project workspace tab): every
 *   schedule that spawns a terminal IN this project (filter on `t.projectId`,
 *   the spawn target), so a global-scoped schedule that targets the project
 *   appears here too. New schedules default to this project + project scope.
 */
export function SchedulerView({ projectId }: { projectId?: string } = {}) {
  const navigate = useNavigate();
  const location = useLocation();
  const tasks = useScheduler((s) => s.tasks);
  const loading = useScheduler((s) => s.loading);
  const projects = useData((s) => s.projects);
  const setNav = useUi((s) => s.setNav);
  const lockedProjectId = projectId ?? null;
  const lockedProject = lockedProjectId
    ? projects.find((p) => p.id === lockedProjectId) ?? null
    : null;
  const [pickingTemplate, setPickingTemplate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ScheduledTask | null>(null);
  const [managingGroups, setManagingGroups] = useState(false);
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState('');
  /** When the user hits "Pause all", we stash the ids that were enabled so
   *  "Resume all" only re-enables those. Session-local — by design. */
  const [pausedSet, setPausedSet] = useState<Set<string> | null>(null);
  const [view, setView] = useState<'overview' | 'schedules'>('overview');

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const revealScheduleId = useUi((s) => s.revealScheduleId);
  const groups = useScheduleGroups((s) => s.groups);

  useEffect(() => {
    setPausedSet(null);
  }, [lockedProjectId, view]);

  const openSchedule = (t: ScheduledTask) => {
    navigate(getScheduleRoutePath(t.id, lockedProjectId));
  };

  const openScheduleSplit = (t: ScheduledTask) => {
    openScheduleInSplit({
      navigate,
      projectId: lockedProjectId,
      scheduleId: t.id,
      isCompact: isCompactViewport(),
      currentPathname: location.pathname
    });
  };

  const openNew = (seed?: ScheduleSeed) => {
    navigate(
      getNewScheduleRoutePath(lockedProjectId),
      seed ? { state: { seed } } : undefined
    );
  };

  // Tray reveal may land on the catalogue before tasks hydrate; once the
  // matching task is in the store, jump to its dedicated page.
  useEffect(() => {
    if (!revealScheduleId) return;
    const task = tasks.find((t) => t.id === revealScheduleId);
    if (!task) return;
    useUi.getState().clearRevealSchedule();
    navigate(getScheduleRoutePath(task.id, lockedProjectId));
  }, [revealScheduleId, tasks, lockedProjectId, navigate]);

  const scopedTasks = useMemo(() => {
    if (lockedProjectId) {
      return tasks.filter((t) => t.projectId === lockedProjectId);
    }
    return tasks;
  }, [tasks, lockedProjectId]);

  const filteredTasks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return scopedTasks;
    return scopedTasks.filter((t) => {
      const project = projects.find((p) => p.id === t.projectId);
      const haystack = [
        t.name,
        t.description ?? '',
        t.profile,
        project?.name ?? ''
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [scopedTasks, projects, search]);

  const pauseAll = async () => {
    const pausable = scopedTasks.filter((t) => t.enabled && t.external?.kind !== 'claude-loop');
    setPausedSet(new Set(pausable.map((t) => t.id)));
    await Promise.all(
      pausable.map((t) => product.scheduler.setEnabled(t.id, false).catch(() => null))
    );
  };

  const resumeAll = async () => {
    if (!pausedSet) return;
    const ids = [...pausedSet];
    setPausedSet(null);
    await Promise.all(
      ids.map((id) => product.scheduler.setEnabled(id, true).catch(() => null))
    );
  };

  const toggleSchedule = async (t: ScheduledTask) => {
    const result = await product.scheduler.setEnabled(t.id, !t.enabled);
    if (!result.ok) useUi.getState().pushToast(result.message, 'error');
  };
  const runScheduleNow = async (t: ScheduledTask) => {
    const result = await product.scheduler.runNow(t.id);
    if (!result.ok) {
      useUi.getState().pushToast(`Run failed: ${result.message}`, 'error');
      return;
    }
    useUi.getState().pushToast(`Fired "${t.name}"`, 'info');
  };
  const stopScheduleLive = async (t: ScheduledTask, sessionId: string) => {
    try {
      if (!await product.terminals.close(sessionId)) {
        throw new Error('session remains live');
      }
      useUi.getState().pushToast(`Stopped "${t.name}"`, 'info');
    } catch {
      useUi.getState().pushToast(`Failed to stop "${t.name}"`, 'error');
    }
  };
  const openProjectSchedules = (id: string) => {
    useUi.getState().enterProjectFocus(id);
    useUi.getState().setProjectView(id, 'scheduler');
  };

  const openByReport = (_run: unknown, taskName: string) => {
    const match = scopedTasks.find((t) => t.name === taskName);
    if (match) openSchedule(match);
  };

  return (
    <div
      className={`settings-panel scheduler-panel${
        lockedProject ? ' scheduler-panel--embedded' : ' scheduler-page'
      }`}
    >
      <div className="settings-inner">
        <div className="scheduler-header">
          <div className="scheduler-header-text">
            {lockedProject ? (
              <h2>Project schedules</h2>
            ) : (
              <h2>Schedules</h2>
            )}
            <p className="settings-help scheduler-subtitle">
              {lockedProject
                ? `Recurring agents that spawn a terminal in ${lockedProject.name} on a fixed interval.`
                : 'Recurring agents that spawn a terminal on a fixed interval.'}
            </p>
          </div>
          <div className="scheduler-header-actions">
            {scopedTasks.length > 0 && (
              <div
                className="scheduler-subview-toggle"
                role="group"
                aria-label="Scheduler view"
              >
                <button
                  type="button"
                  className={view === 'overview' ? 'active' : ''}
                  onClick={() => setView('overview')}
                  aria-pressed={view === 'overview'}
                >
                  <Activity size={13} /> Overview
                </button>
                <button
                  type="button"
                  className={view === 'schedules' ? 'active' : ''}
                  onClick={() => setView('schedules')}
                  aria-pressed={view === 'schedules'}
                >
                  <Clock size={13} /> Schedules
                </button>
              </div>
            )}
            {!lockedProject && (
              <button
                className="settings-btn"
                onClick={() => setManagingGroups(true)}
                title="Manage schedule groups"
              >
                <Settings size={14} /> Groups
              </button>
            )}
            <button
              className="settings-btn"
              onClick={() => setPickingTemplate(true)}
              disabled={projects.length === 0}
              title={projects.length === 0 ? 'Add a project first' : 'Browse templates'}
            >
              <Sparkles size={14} /> From template
            </button>
            <button
              className="settings-btn settings-btn--primary"
              onClick={() => openNew()}
              disabled={projects.length === 0}
              title={projects.length === 0 ? 'Add a project first' : 'New schedule'}
            >
              <Plus size={14} /> New schedule
            </button>
          </div>
        </div>

        <aside className="scheduler-banner-info" role="note">
          <AlertTriangle size={14} />
          <div>
            <strong>Schedules only fire while this app is running.</strong>{' '}
            Closing the app stops all schedules until next launch — there is
            no background daemon. The "app open" pill on each row is a reminder.
          </div>
        </aside>

        {projects.length === 0 ? (
          <div className="scheduler-empty">
            <Clock size={28} className="scheduler-empty-icon" />
            <div className="scheduler-empty-title">No projects yet</div>
            <div className="scheduler-empty-hint">
              Add a project before creating a schedule.{' '}
              <button
                className="settings-btn settings-btn--primary"
                onClick={() => setNav('home')}
                style={{ marginTop: 8 }}
              >
                Go to Projects
              </button>
            </div>
          </div>
        ) : loading ? (
          <DelayedStencilList label="Loading schedules" className="scheduler-empty" />
        ) : view === 'overview' && (!lockedProject || scopedTasks.length > 0) ? (
          <SchedulerOverview
            tasks={lockedProject ? scopedTasks : tasks}
            projects={projects}
            tick={tick}
            hideByProject={Boolean(lockedProject)}
            onJump={openSchedule}
            onOpenProject={lockedProject ? undefined : openProjectSchedules}
            onOpenTerminal={(t, sessionId) => openScheduledLive(t.projectId, sessionId)}
            onEdit={openSchedule}
            onShowReport={openByReport}
            onToggle={toggleSchedule}
            onRunNow={runScheduleNow}
            onStopLive={stopScheduleLive}
          />
        ) : scopedTasks.length === 0 ? (
          <EmptyStateWithFeatured
            onPick={(template: ScheduleTemplate) => openNew({ kind: 'template', template })}
            onCreateBlank={() => openNew()}
          />
        ) : (
          <>
            <div className="scheduler-list-toolbar">
              <input
                className="scheduler-list-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, project, profile…"
              />
              {pausedSet ? (
                <button
                  className="settings-btn scheduler-pause-all"
                  onClick={resumeAll}
                  title="Re-enable schedules that were on before Pause all"
                >
                  <PlayCircle size={14} /> Resume all
                </button>
              ) : (
                <button
                  className="settings-btn scheduler-pause-all"
                  onClick={pauseAll}
                  disabled={
                    !scopedTasks.some((t) => t.enabled && t.external?.kind !== 'claude-loop')
                  }
                  title="Disable every enabled schedule (session-local)"
                >
                  <Pause size={14} /> Pause all
                </button>
              )}
            </div>
            {filteredTasks.length === 0 ? (
              <div className="scheduler-empty">
                <div className="scheduler-empty-title">No schedules match</div>
                <div className="scheduler-empty-hint">
                  Try a different search term or clear the filter.
                </div>
              </div>
            ) : (
              <ul className="scheduler-list">
                {filteredTasks.map((t) => (
                  <ScheduleRow
                    key={t.id}
                    task={t}
                    projectName={
                      projects.find((p) => p.id === t.projectId)?.name ?? '⟨missing⟩'
                    }
                    group={t.group ? groups.find((g) => g.id === t.group) ?? null : null}
                    onOpen={() => openSchedule(t)}
                    onOpenInSplit={() => openScheduleSplit(t)}
                    onDuplicate={() => openNew({ kind: 'duplicate', source: t })}
                    onAskDelete={() => setConfirmDelete(t)}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {pickingTemplate && (
        <TemplatePickerModal
          onClose={() => setPickingTemplate(false)}
          onPick={(template) => {
            setPickingTemplate(false);
            openNew({ kind: 'template', template });
          }}
        />
      )}
      {confirmDelete && (
        <DeleteConfirmModal
          task={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={async () => {
            const id = confirmDelete.id;
            setConfirmDelete(null);
            const result = await product.scheduler.delete(id);
            if (!result.ok) {
              useUi.getState().pushToast(`Delete failed: ${result.message}`, 'error');
            }
          }}
        />
      )}
      {managingGroups && (
        <ScheduleGroupsModal onClose={() => setManagingGroups(false)} />
      )}
    </div>
  );
}

export { SchedulerView as SchedulerPanel };
