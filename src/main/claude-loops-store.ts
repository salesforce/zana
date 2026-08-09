/**
 * Read-only mirror of Claude Code `/loop` cron jobs into the Scheduler view.
 *
 * Claude Code persists DURABLE cron jobs (created via CronCreate with
 * `durable: true`, which `/loop` uses) to a `.claude/scheduled_tasks.json` file
 * next to the session. Session-only loops are never written to disk, so they
 * are intentionally NOT surfaced here (see {@link readClaudeLoops}).
 *
 * The app does NOT own these timers — the Claude harness fires them. We only
 * read the file and project each job into a {@link ScheduledTask}-shaped row
 * (tagged `external.kind === 'claude-loop'`) so it shows up alongside native
 * schedules with a "Claude" badge. Every mutating scheduler path guards on the
 * `external` marker so the app never tries to fire/enable/edit/delete one.
 *
 * Discovery: the home `~/.claude/scheduled_tasks.json` (global loops) plus each
 * registered project's `<project>/.claude/scheduled_tasks.json` (project loops,
 * attributed to that project). A loop with no project file maps to the global
 * scope.
 */

import { app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Project, ScheduledTask } from '../shared/types.js';

/** The on-disk shape Claude Code writes (one record per durable cron job). */
interface RawClaudeCron {
  id: string;
  cron: string;
  prompt: string;
  createdAt?: number;
  createdBySessionId?: string;
  createdByPid?: number;
  createdByProcStart?: string;
}

export const homeTasksFile = () => join(app.getPath('home'), '.claude', 'scheduled_tasks.json');
export const projectTasksFile = (project: Project) =>
  join(project.path, '.claude', 'scheduled_tasks.json');

/**
 * Convert a 5-field cron expression into the human "every …" cadence the
 * Scheduler shows. Covers the forms `/loop` emits (every-N-minutes,
 * every-N-hours, every-N-days, and the daily/weekday pins); anything else
 * falls back to the raw expression so an exotic hand-written cron still renders
 * (just not prettified). Pure + total — never throws.
 */
export function cronToCadence(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;
  const [min, hour, dom, mon, dow] = parts;

  // every N minutes: "*/N * * * *"
  const minEvery = /^\*\/(\d+)$/.exec(min);
  if (minEvery && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return `every ${minEvery[1]}m`;
  }
  // every N hours: "M */N * * *" — require a FIXED minute, else a stepped
  // minute (e.g. "*/5 */2 * * *") would be mislabeled "every 2h", silently
  // dropping the every-5-min component. Such a cron falls through to raw.
  const hourEvery = /^\*\/(\d+)$/.exec(hour);
  if (/^\d+$/.test(min) && hourEvery && dom === '*' && mon === '*' && dow === '*') {
    return `every ${hourEvery[1]}h`;
  }
  // hourly on a fixed minute: "M * * * *"
  if (/^\d+$/.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return 'every 1h';
  }
  // every N days at a fixed time: "M H */N * *"
  const domEvery = /^\*\/(\d+)$/.exec(dom);
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && domEvery && mon === '*' && dow === '*') {
    return `every ${domEvery[1]}d`;
  }
  // daily / weekday at a fixed time: "M H * * *" or "M H * * 1-5"
  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*') {
    const hh = hour.padStart(2, '0');
    const mm = min.padStart(2, '0');
    if (dow === '*') return `daily at ${hh}:${mm}`;
    if (dow === '1-5') return `weekdays at ${hh}:${mm}`;
    return `at ${hh}:${mm} (dow ${dow})`;
  }
  return cron;
}

/**
 * Derive a short display name from a loop's prompt. A slash-command loop
 * (`/babysit-prs …`) shows the command; otherwise the first line, trimmed and
 * capped so a long prompt doesn't blow out the row.
 */
export function loopName(prompt: string): string {
  const firstLine = prompt.split('\n', 1)[0].trim();
  const slash = /^(\/[A-Za-z0-9:_-]+)/.exec(firstLine);
  if (slash) return slash[1];
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine || 'Claude loop';
}

/**
 * Map one raw cron record to a read-only {@link ScheduledTask} row. `projectId`
 * is the owning project (or `''` for a global loop — the row renders under the
 * global tab). `createdAtIso` is stamped by the caller so this stays pure of
 * `Date.now()`.
 */
function toRow(
  raw: RawClaudeCron,
  scope: ScheduledTask['source'],
  projectId: string,
  createdAtIso: string
): ScheduledTask {
  const createdAt = typeof raw.createdAt === 'number' ? new Date(raw.createdAt).toISOString() : createdAtIso;
  return {
    // Namespace the id so it can't collide with a native schedule's id and the
    // mutating handlers can detect it (defense-in-depth alongside `external`).
    id: `claude-loop:${raw.id}`,
    name: loopName(raw.prompt),
    description: raw.prompt,
    enabled: true, // a persisted loop is active; the app can't toggle it anyway
    projectId,
    profile: 'claude',
    prompt: raw.prompt,
    schedule: { every: cronToCadence(raw.cron) },
    overlap: 'skip',
    history: { retain: 0 },
    status: { runCount: 0, runs: [] },
    createdAt,
    updatedAt: createdAt,
    source: scope,
    inboxLevel: 'quiet',
    external: {
      kind: 'claude-loop',
      cron: raw.cron,
      createdBySessionId: raw.createdBySessionId
    }
  };
}

function readFile(path: string): RawClaudeCron[] {
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { tasks?: unknown };
    if (!parsed || !Array.isArray(parsed.tasks)) return [];
    return parsed.tasks.filter(
      (t): t is RawClaudeCron =>
        !!t &&
        typeof t === 'object' &&
        typeof (t as RawClaudeCron).id === 'string' &&
        typeof (t as RawClaudeCron).cron === 'string' &&
        typeof (t as RawClaudeCron).prompt === 'string'
    );
  } catch {
    // A malformed/locked file is non-fatal — just show no Claude loops from it.
    return [];
  }
}

/**
 * All durable Claude `/loop` jobs, projected into read-only schedule rows:
 * the home file (global scope) plus each project's file (that project's scope).
 * `nowIso` is injected so the module stays free of ambient clock reads.
 */
export function readClaudeLoops(projects: Project[], nowIso: string): ScheduledTask[] {
  const out: ScheduledTask[] = [];
  for (const raw of readFile(homeTasksFile())) {
    out.push(toRow(raw, 'global', '', nowIso));
  }
  for (const p of projects) {
    for (const raw of readFile(projectTasksFile(p))) {
      out.push(toRow(raw, { projectId: p.id }, p.id, nowIso));
    }
  }
  return out;
}
