import type { ScheduledTask, LaunchProfileId, Project, ScheduleTemplate, ScheduleRun, TerminalSession } from '@zana-ai/zcc-domain/product';
import { parseEvery, formatInterval } from '@zana-ai/zcc-domain/parse-every';
import { reasonHint, reasonLabel } from '@zana-ai/zcc-domain/schedule-health';
import { lastRunSkipped, type SkippedLastRun } from '@zana-ai/zcc-domain/schedule-skipped';
import {
  ShieldCheck,
  Sun,
  Package,
  Activity,
  Inbox as InboxIcon,
  Clock,
  Sparkles,
  type LucideIcon
} from 'lucide-react';

/** The three inbox-loudness choices, in increasing loudness, for the form picker. */
export const INBOX_LEVELS: ReadonlyArray<{ value: 'silent' | 'quiet' | 'loud'; title: string; hint: string }> = [
  {
    value: 'silent',
    title: 'Silent',
    hint: "Don't record runs in the inbox at all."
  },
  {
    value: 'quiet',
    title: 'Quiet',
    hint: 'Record in the collapsed "Scheduled" group — no unread badge.'
  },
  {
    value: 'loud',
    title: 'Notify',
    hint: 'Show inline and count toward the unread inbox badge.'
  }
];

/** A Missed runs choice: a Recovery `catchUp.mode`, or the schedule's original rules (no `catchUp`). */
export type MissedRunChoiceValue = 'original' | 'once' | 'skip' | 'all';
export interface PolicyChoice<V extends string> { value: V; title: string; hint: string }

/**
 * Missed runs choices, worded by what the schedule does. The "original rules"
 * choice only exists for a schedule that already uses them (one saved before
 * recovery existed), and its wording depends on the cadence because those
 * rules differ for interval and cron schedules.
 */
export function missedRunChoices(cadence: 'interval' | 'cron', includeOriginal: boolean): ReadonlyArray<PolicyChoice<MissedRunChoiceValue>> {
  const choices: PolicyChoice<MissedRunChoiceValue>[] = [
    {
      value: 'once',
      title: 'Run once',
      hint: 'Recommended. Catch up with one run for the latest missed time. If too many runs are going, it waits its turn.'
    },
    {
      value: 'all',
      title: 'Run each missed time',
      hint: 'Run every missed time, oldest first, one after another, up to the number below.'
    },
    {
      value: 'skip',
      title: "Don't catch up",
      hint: 'Wait for the next scheduled time. Missed times are listed in Problems, where you can run them by hand.'
    }
  ];
  if (includeOriginal) {
    choices.push(cadence === 'interval'
      ? {
          value: 'original',
          title: 'Run once, unless several were missed',
          hint: 'Run once if one time was missed; if two or more were missed, wait for the next time. Skipped, not queued, when too many runs are going.'
        }
      : {
          value: 'original',
          title: 'Run once, skip when busy',
          hint: 'Run once for the latest missed time, but skip it when too many runs are going. Turning a schedule back on also runs the time it missed.'
        });
  }
  return choices;
}

/** Auto-retry choices. */
export const RETRY_CHOICES: ReadonlyArray<PolicyChoice<'off' | 'on'>> = [
  {
    value: 'off',
    title: "Don't retry",
    hint: 'A failed run waits for its next scheduled time. You can retry it by hand from Problems.'
  },
  {
    value: 'on',
    title: 'Retry failed runs',
    hint: 'Retry failures that are likely temporary (an error exit, a missing report, a run that could not start), waiting longer after each attempt.'
  }
];


export const PROFILE_LABEL: Record<LaunchProfileId, string> = {
  shell: 'Shell',
  claude: 'claude',
  'claude-resume': 'claude --resume',
  'claude-yolo': 'claude --yolo',
  cursor: 'cursor',
  'cursor-resume': 'cursor --resume',
  'cursor-yolo': 'cursor --force',
  codex: 'codex',
  'codex-resume': 'codex resume',
  'codex-yolo': 'codex --yolo',
  pi: 'pi',
  'pi-resume': 'pi --continue',
  opencode: 'opencode',
  'opencode-resume': 'opencode --continue',
  'opencode-yolo': 'opencode --auto',
  grok: 'grok',
  'grok-resume': 'grok --continue',
  'grok-yolo': 'grok --always-approve',
  mastracode: 'mastracode',
  'mastracode-resume': 'mastracode --continue',
  'mastracode-yolo': 'mastracode (yolo)',
  afcode: 'afcode --local',
  'afcode-resume': 'afcode --local --resume',
  'afcode-yolo': 'afcode --local --auto-approve'
};

/** Whitelist of lucide icon names we honor in template metadata. Anything
 *  else falls back to the generic Sparkles icon so a typo in a hand-edited
 *  template doesn't crash the renderer. */
const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  ShieldCheck,
  Sun,
  Package,
  Activity,
  Inbox: InboxIcon,
  Clock,
  Sparkles
};

export function templateIcon(name: string | undefined): LucideIcon {
  return (name && TEMPLATE_ICONS[name]) || Sparkles;
}

export function sourceLabel(source: ScheduleTemplate['source']): string {
  if (!source || source === 'builtin') return 'Built-in';
  if (source === 'user') return 'User';
  return source.projectName ? `Project · ${source.projectName}` : 'Project';
}

/** Label for a schedule's scope, used in the read-only Edit field. */
export function scopeLabel(task: ScheduledTask | null, projects: Project[]): string {
  if (!task || !task.source || task.source === 'global') return 'Global';
  const project = projects.find((p) => p.id === (task.source as { projectId: string }).projectId);
  return project ? `Project · ${project.name}` : 'Project';
}

/**
 * Human cadence label for a task's schedule. A task fires on exactly ONE of
 * `every` (interval) or `cron` (5-field expression); render whichever is set so
 * the cron case doesn't feed `undefined` into the interval formatter.
 */
export function cadenceLabel(schedule: { every?: string; cron?: string }): string {
  if (schedule.cron) return `cron ${schedule.cron}`;
  return `every ${formatInterval(parseEvery(schedule.every ?? '') ?? 0)}`;
}

/**
 * Pick the run whose session should drive the row's live status. Walks
 * newest→oldest and prefers a still-WORKING alive run (no `finishedAt`) over a
 * finished-but-open one, because a schedule can have two live sessions at once
 * (a slow run still working while a quick later run finished but stayed at the
 * prompt). Newest-first alone would surface the finished run and mislabel the
 * row "done" while the earlier one is still working. Falls back to the newest
 * alive finished-open run when nothing is actively working. Returns null when no
 * run's session is alive. Exported for unit tests.
 */
export function pickLiveRun(
  runs: ScheduleRun[],
  isAlive: (sessionId: string) => boolean
): ScheduleRun | null {
  let finishedOpen: ScheduleRun | null = null;
  for (const run of runs) {
    if (!run.sessionId || !isAlive(run.sessionId)) continue;
    if (!run.finishedAt) return run; // actively working — takes precedence
    if (!finishedOpen) finishedOpen = run; // newest finished-but-open, remembered
  }
  return finishedOpen;
}

/**
 * Whether a run's pty/thread is still open: listed for its project and `running` or `starting`.
 * The one rule for "this run is open" on the Overview, the schedule row and the info panel.
 */
export function isSessionAlive(
  sessions: ReadonlyArray<Pick<TerminalSession, 'id' | 'status'>> | undefined,
  sessionId: string | undefined
): boolean {
  return !!sessionId && (sessions ?? []).some((s) => s.id === sessionId && (s.status === 'running' || s.status === 'starting'));
}

/** Alive pty/thread id for a schedule, or null when nothing is running. */
export function liveSessionIdForTask(
  task: Pick<ScheduledTask, 'projectId' | 'status'>,
  terminals: Record<string, Array<Pick<TerminalSession, 'id' | 'status'>> | undefined>
): string | null {
  const list = terminals[task.projectId];
  return pickLiveRun(task.status.runs ?? [], (sessionId) => isSessionAlive(list, sessionId))?.sessionId ?? null;
}

export function formatRelative(d: Date): string {
  const ms = Math.max(0, Date.now() - d.getTime());
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return `${m}m ${remS}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}

export function formatCountdown(d: Date): string {
  const ms = d.getTime() - Date.now();
  if (ms <= 0) return 'now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remS = s % 60;
  if (m < 60) return `${m}m ${remS}s`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${remM}m`;
}

/** When a skipped slot was due: the time today, the weekday and time within a week, else the date. */
function skippedWhen(slotMs: number, nowMs: number): string {
  const slot = new Date(slotMs);
  const time = slot.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const now = new Date(nowMs);
  const calendarDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const daysAgo = (calendarDay(now) - calendarDay(slot)) / 86_400_000;
  if (daysAgo === 0) return time;
  if (daysAgo > 0 && daysAgo < 7) return `${slot.toLocaleDateString([], { weekday: 'short' })} ${time}`;
  return slot.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

/** The pill text and hover title for a schedule that skipped its last run. */
export function skippedLastRunLabel(skipped: SkippedLastRun, nowMs: number, squad = false): { text: string; title: string } {
  const when = skippedWhen(Date.parse(skipped.slotAt), nowMs);
  const { reason } = skipped;
  const text = reason ? `skipped ${when} · ${reasonLabel(reason)}` : `skipped ${when}`;
  let detail: string;
  if (reason === 'overlap') {
    detail = squad
      ? "The previous Squad run was still running, so this run didn't start."
      : "The previous run's session was still open, so this run didn't start. Close that session or press Run now.";
  } else if (reason) {
    detail = `${reasonHint(reason)} Press Run now to run it.`;
  } else {
    detail = 'No run was recorded for this time. Press Run now to run it.';
  }
  return { text, title: `Skipped the ${when} run. ${detail}` };
}

/** The skipped pill for a schedule row, or null: /loop rows and schedules that ran their last due time get none. */
export function skippedLastRunPill(task: ScheduledTask, nowMs: number): { text: string; title: string } | null {
  if (task.external?.kind === 'claude-loop') return null;
  const skipped = lastRunSkipped(task, nowMs);
  return skipped ? skippedLastRunLabel(skipped, nowMs, task.kind === 'team') : null;
}
