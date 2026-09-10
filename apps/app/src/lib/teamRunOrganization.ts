import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import { teamRunLabel } from './executionIdentity.js';

export interface TeamRunSessionGroup<T extends { session: TerminalSession }> {
  key: string;
  label: string;
  items: T[];
  isTeamRun: boolean;
}

/** Group concrete launches, never Team templates. Ungrouped sessions stay visible. */
export function groupSessionsByTeamRun<T extends { session: TerminalSession }>(items: T[]): TeamRunSessionGroup<T>[] {
  const groups: TeamRunSessionGroup<T>[] = [];
  const byKey = new Map<string, TeamRunSessionGroup<T>>();
  for (const item of items) {
    const cohort = item.session.cohort;
    const key = cohort ? `run:${cohort.executionId ?? cohort.cohortId}` : 'other';
    let group = byKey.get(key);
    if (!group) {
      group = {
        key,
        label: cohort ? teamRunLabel(cohort) : 'Other agents',
        items: [],
        isTeamRun: Boolean(cohort)
      };
      byKey.set(key, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/** Team-runs project navigation shows one coordinator per run, plus solo sessions. */
export function projectNavigationSessions(
  sessions: TerminalSession[],
  organization: 'sessions' | 'team-runs'
): TerminalSession[] {
  return organization === 'team-runs'
    ? sessions.filter((session) => session.cohort?.role !== 'worker')
    : sessions;
}
