import type { ScheduledTask, LaunchProfileId, Project, ScheduleTemplate, ScheduleRun } from '@zana-ai/zcc-domain/product';
import { parseEvery, formatInterval } from '@zana-ai/zcc-domain/parse-every';
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
  'opencode-resume': 'opencode --continue'
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
