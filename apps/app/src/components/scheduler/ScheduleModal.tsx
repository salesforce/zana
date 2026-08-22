import { product } from '../../lib/product-client.js';
import React, { useState, useMemo } from 'react';
import { Sparkles, Copy } from 'lucide-react';
import { VALID_PROFILES } from '@zana-ai/zcc-domain/launch-provider';
import type {
  LaunchProfileId,
  ScheduledTask,
  ScheduleCreateInput,
  ScheduleTemplate,
  InboxNotifyLevel
} from '@zana-ai/zcc-domain/product';
import { parseEvery, formatInterval } from '@zana-ai/zcc-domain/parse-every';
import { isValidCron, nextCronRuns } from '@zana-ai/zcc-domain/parse-cron';
import { useData, useUi, useScheduleGroups } from '../../store.js';
import { Modal } from '../Modal.js';
import { ImprovePromptButton } from '../ImprovePromptButton.js';
import { PopoverPicklist } from '../ui/PopoverPicklist.js';
import { PROFILE_LABEL, INBOX_LEVELS, scopeLabel, sourceLabel } from './schedulerUtils.js';

/** Seed values handed to ScheduleModal. May come from a template ("Use this")
 *  or a duplicate of an existing schedule ("Duplicate"). */
type Seed =
  | { kind: 'template'; template: ScheduleTemplate }
  | { kind: 'duplicate'; source: ScheduledTask };

interface ScheduleModalProps {
  task: ScheduledTask | null;
  seed?: Seed | null;
  /** When the panel is locked to one project (the per-project tab), a NEW
   *  schedule pre-selects that project + project scope. */
  lockedProjectId?: string | null;
  onClose: () => void;
}

const PROFILES = VALID_PROFILES;

export function ScheduleModal({ task, seed, lockedProjectId, onClose }: ScheduleModalProps) {
  const projects = useData((s) => s.projects);
  const schedulerTab = useUi((s) => s.schedulerTab);
  const selectedProjectId = useUi((s) => s.selectedProjectId);
  const selectedGroupId = useUi((s) => s.selectedGroupId);
  const groups = useScheduleGroups((s) => s.groups);
  const seededTask = seed?.kind === 'duplicate' ? seed.source : null;
  const seededTemplate = seed?.kind === 'template' ? seed.template : null;

  const [name, setName] = useState(
    task?.name
      ?? (seededTask ? `${seededTask.name} (copy)` : undefined)
      ?? seededTemplate?.defaults.name
      ?? seededTemplate?.name
      ?? ''
  );
  const [description, setDescription] = useState(
    task?.description
      ?? seededTask?.description
      ?? seededTemplate?.defaults.description
      ?? seededTemplate?.description
      ?? ''
  );
  const [projectId, setProjectId] = useState(
    task?.projectId
      ?? seededTask?.projectId
      ?? lockedProjectId
      ?? (schedulerTab === 'project' ? selectedProjectId : null)
      ?? projects[0]?.id
      ?? ''
  );
  const [profile, setProfile] = useState<LaunchProfileId>(
    task?.profile ?? seededTask?.profile ?? seededTemplate?.defaults.profile ?? 'claude'
  );
  // Cadence mode: interval ("every 1h") vs cron ("0 9 * * 1-5"). Seeded from the
  // task/duplicate source; templates only carry intervals.
  const seedCron = task?.schedule.cron ?? seededTask?.schedule.cron;
  const [cadenceMode, setCadenceMode] = useState<'interval' | 'cron'>(
    seedCron ? 'cron' : 'interval'
  );
  const [every, setEvery] = useState(
    task?.schedule.every ?? seededTask?.schedule.every ?? seededTemplate?.defaults.every ?? '1h'
  );
  const [cron, setCron] = useState(seedCron ?? '0 9 * * 1-5');
  const [tz, setTz] = useState(task?.schedule.tz ?? seededTask?.schedule.tz ?? '');
  const [prompt, setPrompt] = useState(
    task?.prompt ?? seededTask?.prompt ?? seededTemplate?.defaults.prompt ?? ''
  );
  const [inboxLevel, setInboxLevel] = useState<InboxNotifyLevel>(
    task?.inboxLevel ?? seededTask?.inboxLevel ?? 'quiet'
  );
  // Default ON for new schedules: a scheduled run is background work, so closing
  // the session once the agent finishes keeps the tab strip clean. Existing
  // schedules keep whatever they saved; duplicates inherit the source's choice.
  const [autoCloseOnFinish, setAutoCloseOnFinish] = useState<boolean>(
    task?.autoCloseOnFinish ?? seededTask?.autoCloseOnFinish ?? true
  );
  const [scope, setScope] = useState<'global' | 'project'>(() => {
    if (task?.source && task.source !== 'global') return 'project';
    if (seededTask?.source && seededTask.source !== 'global') return 'project';
    if (task === null && !seededTask && lockedProjectId) return 'project';
    if (task === null && !seededTask && schedulerTab === 'project' && selectedProjectId) {
      return 'project';
    }
    return 'global';
  });
  // Group (global scope only). New schedules created from inside a group tab
  // pre-select that group; otherwise inherit from the task / duplicate source.
  const [group, setGroup] = useState<string>(
    task?.group
      ?? seededTask?.group
      ?? (task === null && !seededTask && schedulerTab === 'group' ? selectedGroupId ?? '' : '')
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isNew = task === null;
  const intervalMs = useMemo(() => parseEvery(every), [every]);
  const intervalValid = intervalMs !== null;
  const cronValid = useMemo(
    () => isValidCron(cron, tz.trim() || undefined),
    [cron, tz]
  );
  // Live preview of the next few cron fires, recomputed as the user types. `now`
  // is captured per-render (not memoized on a timer) — good enough for a preview.
  const cronPreview = useMemo(() => {
    if (cadenceMode !== 'cron' || !cronValid) return [];
    return nextCronRuns(cron, tz.trim() || undefined, 3, new Date());
  }, [cadenceMode, cronValid, cron, tz]);
  const cadenceValid = cadenceMode === 'cron' ? cronValid : intervalValid;
  const canSave = useMemo(
    () => name.trim().length > 0 && Boolean(projectId) && cadenceValid,
    [name, projectId, cadenceValid]
  );

  const banner = (() => {
    if (seededTemplate) {
      return (
        <div className="scheduler-template-banner">
          <Sparkles size={14} />
          <span>
            Pre-filled from template <strong>{seededTemplate.name}</strong>{' '}
            <span className="scheduler-pill scheduler-pill--source">
              {sourceLabel(seededTemplate.source)}
            </span>
          </span>
        </div>
      );
    }
    if (seededTask) {
      return (
        <div className="scheduler-template-banner">
          <Copy size={14} />
          <span>
            Duplicating <strong>{seededTask.name}</strong> — change the name or
            project before saving.
          </span>
        </div>
      );
    }
    return null;
  })();

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      if (isNew) {
        const cadence =
          cadenceMode === 'cron'
            ? { cron: cron.trim(), tz: tz.trim() || undefined }
            : { every };
        const input: ScheduleCreateInput = {
          name: name.trim(),
          description: description.trim() || undefined,
          enabled: true,
          projectId,
          profile,
          ...cadence,
          prompt: prompt.trim() || undefined,
          extraArgs: seededTemplate?.defaults.extraArgs ?? seededTask?.extraArgs,
          scope: scope === 'project' ? { projectId } : 'global',
          inboxLevel,
          autoCloseOnFinish,
          // Group only applies to global scope; main drops it for project scope.
          group: scope === 'global' && group ? group : undefined
        };
        const result = await product.scheduler.create(input);
        if (!result.ok) {
          setError(result.message);
          setSaving(false);
          return;
        }
      } else {
        const isGlobalTask = !task!.source || task!.source === 'global';
        // Send only the active cadence — main clears the other side. `tz: null`
        // on a cron edit clears any stale zone when the field is emptied.
        const cadence =
          cadenceMode === 'cron'
            ? { cron: cron.trim(), tz: tz.trim() || null }
            : { every };
        const result = await product.scheduler.update(task!.id, {
          name: name.trim(),
          description: description.trim(),
          projectId,
          profile,
          ...cadence,
          prompt,
          inboxLevel,
          autoCloseOnFinish,
          // Only global schedules carry a group. `null` clears → Ungrouped.
          ...(isGlobalTask ? { group: group || null } : {})
        });
        if (!result.ok) {
          setError(result.message);
          setSaving(false);
          return;
        }
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  return (
    <Modal
      title={
        isNew
          ? seededTemplate
            ? `New schedule · ${seededTemplate.name}`
            : seededTask
            ? 'Duplicate schedule'
            : 'New schedule'
          : 'Edit schedule'
      }
      onClose={onClose}
      className="scheduler-modal"
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            onClick={save}
            disabled={!canSave || saving}
            title={canSave ? '⌘+Enter to save' : 'Fix the errors above'}
          >
            {saving ? 'Saving…' : isNew ? 'Create schedule' : 'Save changes'}
          </button>
        </>
      }
    >
      {banner}
      <div className="scheduler-form-field">
        <label htmlFor="sched-name">Name</label>
        <input
          id="sched-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          placeholder="Morning standup digest"
        />
      </div>
      <div className="scheduler-form-field">
        <label htmlFor="sched-desc">Description <span className="scheduler-form-optional">(optional)</span></label>
        <input
          id="sched-desc"
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="scheduler-form-row">
        <div className="scheduler-form-field">
          <label htmlFor="sched-project">Project</label>
          <PopoverPicklist
            id="sched-project"
            ariaLabel="Project"
            value={projectId}
            onChange={setProjectId}
            placeholder="Choose project"
            searchPlaceholder="Search projects"
            options={projects.map((project) => ({ value: project.id, label: project.name }))}
          />
        </div>
        <div className="scheduler-form-field">
          <label htmlFor="sched-profile">Launch profile</label>
          <PopoverPicklist
            id="sched-profile"
            ariaLabel="Launch profile"
            value={profile}
            searchable={false}
            onChange={(nextProfile) => setProfile(nextProfile as LaunchProfileId)}
            options={PROFILES.map((profile) => ({ value: profile, label: PROFILE_LABEL[profile] }))}
          />
        </div>
      </div>
      {isNew ? (
        <div className="scheduler-form-field">
          <label>Scope</label>
          <div className="scheduler-scope-picker" role="radiogroup">
            <label className={`scheduler-scope-option ${scope === 'global' ? 'is-active' : ''}`}>
              <input
                type="radio"
                name="sched-scope"
                checked={scope === 'global'}
                onChange={() => setScope('global')}
              />
              <div className="scheduler-scope-option-body">
                <span className="scheduler-scope-title">Global</span>
                <span className="scheduler-scope-hint">~/.zcc/schedules — visible across the app</span>
              </div>
            </label>
            <label className={`scheduler-scope-option ${scope === 'project' ? 'is-active' : ''}`}>
              <input
                type="radio"
                name="sched-scope"
                checked={scope === 'project'}
                onChange={() => setScope('project')}
              />
              <div className="scheduler-scope-option-body">
                <span className="scheduler-scope-title">Project</span>
                <span className="scheduler-scope-hint">
                  &lt;project&gt;/.zcc/schedules — checked in with the repo
                </span>
              </div>
            </label>
          </div>
        </div>
      ) : (
        <div className="scheduler-form-field">
          <label>Scope</label>
          <div className="scheduler-scope-readonly">
            <span className="scheduler-pill scheduler-pill--source">
              {scopeLabel(task, projects)}
            </span>
            <span className="scheduler-form-optional">
              Move the JSON file by hand to change scope.
            </span>
          </div>
        </div>
      )}
      {scope === 'global' && (
        <div className="scheduler-form-field">
          <label htmlFor="sched-group">
            Group <span className="scheduler-form-optional">(optional)</span>
          </label>
          <PopoverPicklist
            id="sched-group"
            ariaLabel="Group"
            value={group}
            onChange={setGroup}
            options={[
              { value: '', label: 'Ungrouped' },
              ...groups.map((item) => ({ value: item.id, label: item.name })),
              ...(group && !groups.some((item) => item.id === group)
                ? [{ value: group, label: `${group} (deleted)` }]
                : [])
            ]}
          />
          <p className="modal-hint">
            Sort this schedule into a Personal / Work bucket. Manage groups
            from the Groups button in the Scheduler header.
          </p>
        </div>
      )}
      <div className="scheduler-form-field">
        <label>Cadence</label>
        <div className="settings-scope-toggle" role="tablist" aria-label="Cadence mode">
          <button
            type="button"
            role="tab"
            aria-selected={cadenceMode === 'interval'}
            className={cadenceMode === 'interval' ? 'active' : ''}
            onClick={() => setCadenceMode('interval')}
          >
            Interval
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={cadenceMode === 'cron'}
            className={cadenceMode === 'cron' ? 'active' : ''}
            onClick={() => setCadenceMode('cron')}
          >
            Cron
          </button>
        </div>
        {cadenceMode === 'interval' ? (
          <>
            <input
              id="sched-every"
              type="text"
              value={every}
              onChange={(e) => setEvery(e.target.value)}
              placeholder="5m, 1h, 24h"
              className={every.trim() && !intervalValid ? 'is-invalid' : ''}
            />
            {every.trim() ? (
              intervalValid ? (
                <p className="scheduler-interval-feedback scheduler-interval-feedback--ok">
                  ≈ every {formatInterval(intervalMs!)}
                </p>
              ) : (
                <p className="scheduler-interval-feedback scheduler-interval-feedback--err">
                  Invalid format. Use units: <code>s</code>, <code>m</code>, <code>h</code>, <code>d</code> (e.g. <code>1h30m</code>).
                </p>
              )
            ) : (
              <p className="modal-hint">Minimum 1 minute. Examples: <code>5m</code>, <code>1h</code>, <code>1h30m</code>, <code>24h</code>.</p>
            )}
          </>
        ) : (
          <>
            <input
              id="sched-cron"
              type="text"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 9 * * 1-5"
              spellCheck={false}
              className={cron.trim() && !cronValid ? 'is-invalid' : ''}
            />
            <input
              id="sched-tz"
              type="text"
              value={tz}
              onChange={(e) => setTz(e.target.value)}
              placeholder="Timezone (optional, e.g. Europe/Paris)"
              spellCheck={false}
              style={{ marginTop: 6 }}
            />
            {cron.trim() && !cronValid ? (
              <p className="scheduler-interval-feedback scheduler-interval-feedback--err">
                Invalid cron. 5 fields: <code>min hour day-of-month month day-of-week</code> (e.g. <code>0 9 * * 1-5</code> = weekdays at 09:00).
              </p>
            ) : cronPreview.length > 0 ? (
              <p className="scheduler-interval-feedback scheduler-interval-feedback--ok">
                Next: {cronPreview.map((d) => d.toLocaleString()).join(' · ')}
              </p>
            ) : (
              <p className="modal-hint">
                Wall-clock schedule. Note: fires only while the app is running — a slot missed while closed runs once on next launch.
              </p>
            )}
          </>
        )}
      </div>
      <div className="scheduler-form-field">
        <label htmlFor="sched-prompt">Initial prompt <span className="scheduler-form-optional">(optional)</span></label>
        <textarea
          id="sched-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          placeholder="Passed to the spawned terminal as the initial prompt."
        />
        <ImprovePromptButton value={prompt} onChange={setPrompt} />
      </div>
      <div className="scheduler-form-field">
        <label>Inbox notifications</label>
        <div className="scheduler-scope-picker" role="radiogroup">
          {INBOX_LEVELS.map(({ value, title, hint }) => (
            <label
              key={value}
              className={`scheduler-scope-option ${inboxLevel === value ? 'is-active' : ''}`}
            >
              <input
                type="radio"
                name="sched-inbox-level"
                checked={inboxLevel === value}
                onChange={() => setInboxLevel(value)}
              />
              <div className="scheduler-scope-option-body">
                <span className="scheduler-scope-title">{title}</span>
                <span className="scheduler-scope-hint">{hint}</span>
              </div>
            </label>
          ))}
        </div>
      </div>
      <div className="scheduler-form-field">
        <label
          className="scheduler-checkbox-row"
          title={
            profile === 'shell'
              ? 'Only available for claude profiles — a shell has no "finished" signal.'
              : undefined
          }
        >
          <input
            type="checkbox"
            checked={autoCloseOnFinish && profile !== 'shell'}
            disabled={profile === 'shell'}
            onChange={(e) => setAutoCloseOnFinish(e.target.checked)}
          />
          <span>
            Auto-close when finished
            <span className="scheduler-form-optional">
              {' '}— close the terminal once Claude finishes responding
              (via a Stop hook). Otherwise the tab stays open.
            </span>
          </span>
        </label>
      </div>
      {error && <div className="modal-error">{error}</div>}
    </Modal>
  );
}
