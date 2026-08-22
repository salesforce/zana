import { product } from '../../lib/product-client.js';
import React, { useEffect, useMemo, useState } from 'react';
import { Clock, Plus, Sparkles, Pause, PlayCircle, AlertTriangle, Activity, Settings } from 'lucide-react';
import type { ScheduledTask, ScheduleRun, ScheduleTemplate } from '@zana-ai/zcc-domain/product';
import { useData, useScheduler, useScheduleGroups, useUi } from '@/store';
import { EmptyStateWithFeatured } from '@/components/scheduler/EmptyStateWithFeatured';
import { ScheduleRow } from '@/components/scheduler/ScheduleRow';
import { ScheduleModal } from '@/components/scheduler/ScheduleModal';
import { DeleteConfirmModal } from '@/components/scheduler/DeleteConfirmModal';
import { RunReportModal } from '@/components/scheduler/RunReportModal';
import { TemplatePickerModal } from '@/components/scheduler/TemplatePickerModal';
import { SchedulerOverview } from '@/components/scheduler/SchedulerOverview';
import { ScheduleGroupsModal } from '@/components/ScheduleGroupsModal';

/** Seed values handed to ScheduleModal. May come from a template (“Use this”)
 *  or a duplicate of an existing schedule (“Duplicate”). */
type Seed =
  | { kind: 'template'; template: ScheduleTemplate }
  | { kind: 'duplicate'; source: ScheduledTask };

export { pickLiveRun } from '@/components/scheduler/schedulerUtils';

function isSeed(value: unknown): value is Seed {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    ((value as { kind: string }).kind === 'template' ||
      (value as { kind: string }).kind === 'duplicate')
  );
}

/**
 * The Scheduler view. Mounted two ways:
 * - Cross-project (top-level nav, no props): every schedule, Overview first.
 * - Project-locked (`projectId` set — the per-project workspace tab): every
 *   schedule that spawns a terminal IN this project (filter on `t.projectId`,
 *   the spawn target), so a global-scoped schedule that targets the project
 *   appears here too. The create modal defaults to this project + project scope.
 */
export function SchedulerView({ projectId }: { projectId?: string } = {}) {
  const tasks = useScheduler((s) => s.tasks);
  const loading = useScheduler((s) => s.loading);
  const projects = useData((s) => s.projects);
  const setNav = useUi((s) => s.setNav);
  const lockedProjectId = projectId ?? null;
  const lockedProject = lockedProjectId
    ? projects.find((p) => p.id === lockedProjectId) ?? null
    : null;
  const [editing, setEditing] = useState<ScheduledTask | 'new' | Seed | null>(null);
  const [pickingTemplate, setPickingTemplate] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<ScheduledTask | null>(null);
  const [managingGroups, setManagingGroups] = useState(false);
  // Run report viewer — lifted here so both the per-task run rows and the
  // Overview "Recent activity" list open the same modal.
  const [report, setReport] = useState<{ run: ScheduleRun; taskName: string } | null>(null);
  const showReport = (run: ScheduleRun, taskName: string) => setReport({ run, taskName });
  const [tick, setTick] = useState(0);
  const [search, setSearch] = useState('');
  /** When the user hits "Pause all", we stash the ids that were enabled so
   *  "Resume all" only re-enables those. Session-local — by design. */
  const [pausedSet, setPausedSet] = useState<Set<string> | null>(null);
  const [view, setView] = useState<'overview' | 'schedules'>('overview');

  // 1Hz tick drives the per-row "fires in 14m 32s" countdown and the Overview's
  // time-relative computations without the main process pushing the same number
  // every second. `tick` is also passed into SchedulerOverview so that component
  // shares this single timer instead of running its own.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const revealScheduleId = useUi((s) => s.revealScheduleId);
  const groups = useScheduleGroups((s) => s.groups);

  useEffect(() => {
    setPausedSet(null);
  }, [lockedProjectId, view]);

  // Tray "Show in Scheduler" lands on the list so ScheduleRow can scroll to
  // and highlight the matching card.
  useEffect(() => {
    if (revealScheduleId) setView('schedules');
  }, [revealScheduleId]);

  const scopedTasks = useMemo(() => {
    // Project-locked (per-project tab): every schedule that spawns in this
    // project, regardless of where its JSON lives (global vs project scope).
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
    // External claude-loop rows are read-only projections the app can't toggle
    // (main no-ops setEnabled for them since they're not in scheduler.live), so
    // exclude them: adding them to pausedSet would falsely paint them "paused"
    // while they keep running, and firing setEnabled on them is a wasted IPC.
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

  const handleSeedFromTask = (source: ScheduledTask) => {
    setEditing({ kind: 'duplicate', source });
  };

  // Shared SchedulerOverview handlers — used by both the cross-project overview
  // and the per-project overview (the scoped tab).
  const openScheduledTerminal = (t: ScheduledTask, sessionId: string) => {
    // Scheduled fires are headless — restoreTerminal un-hides the session
    // before selecting it. enterProjectFocus (not selectProject) is required:
    // the Workspace — and its tab strip — only mounts when focusedProjectId is
    // set; setWorkspaceMode('terminals') lands on the tab, not the Agents board.
    useUi.getState().enterProjectFocus(t.projectId);
    void useData.getState().restoreTerminal(sessionId, t.projectId);
    useUi.getState().setWorkspaceMode(t.projectId, 'terminals');
  };
  const toggleSchedule = async (t: ScheduledTask) => {
    const result = await product.scheduler.setEnabled(t.id, !t.enabled);
    if (!result.ok) useUi.getState().pushToast(result.message, 'error');
  };
  // Fire a schedule immediately from the overview's "All schedules" list — the
  // same gesture as a card's Run-now button (headless background fire; the
  // toast confirms it took, deep-links / the live row can promote it to a tab).
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
    useUi.getState().setWorkspaceMode(id, 'scheduler');
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
              onClick={() => setEditing('new')}
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
          <div className="scheduler-empty">Loading…</div>
        ) : view === 'overview' && (!lockedProject || scopedTasks.length > 0) ? (
          <SchedulerOverview
            tasks={lockedProject ? scopedTasks : tasks}
            projects={projects}
            tick={tick}
            hideByProject={Boolean(lockedProject)}
            onJump={lockedProject ? () => setView('schedules') : (t) => setEditing(t)}
            onOpenProject={lockedProject ? undefined : openProjectSchedules}
            onOpenTerminal={openScheduledTerminal}
            onEdit={(t) => setEditing(t)}
            onShowReport={showReport}
            onToggle={toggleSchedule}
            onRunNow={runScheduleNow}
            onStopLive={stopScheduleLive}
          />
        ) : scopedTasks.length === 0 ? (
          <EmptyStateWithFeatured
            onPick={(template) => setEditing({ kind: 'template', template })}
            onCreateBlank={() => setEditing('new')}
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
                    reveal={revealScheduleId === t.id}
                    onEdit={() => setEditing(t)}
                    onDuplicate={() => handleSeedFromTask(t)}
                    onAskDelete={() => setConfirmDelete(t)}
                    onShowReport={showReport}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {editing && (
        <ScheduleModal
          task={
            editing === 'new' || isSeed(editing) ? null : (editing as ScheduledTask)
          }
          seed={isSeed(editing) ? editing : null}
          lockedProjectId={lockedProjectId}
          onClose={() => setEditing(null)}
        />
      )}
      {pickingTemplate && (
        <TemplatePickerModal
          onClose={() => setPickingTemplate(false)}
          onPick={(template) => {
            setPickingTemplate(false);
            setEditing({ kind: 'template', template });
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
      {report && (
        <RunReportModal
          run={report.run}
          taskName={report.taskName}
          onClose={() => setReport(null)}
        />
      )}
      {managingGroups && (
        <ScheduleGroupsModal onClose={() => setManagingGroups(false)} />
      )}
    </div>
  );
}

export { SchedulerView as SchedulerPanel };
