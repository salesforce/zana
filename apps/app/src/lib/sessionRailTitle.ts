import type { TerminalSession } from '@zana-ai/zcc-domain/product';

/** Squad workers keep their own title; only the orchestrator row is named after the execution job. */
export function sessionRailTitle(session: Pick<TerminalSession, 'title' | 'cohort'>): string {
  const cohort = session.cohort;
  if (cohort?.role === 'orchestrator') return cohort.executionJobTitle?.trim() || session.title;
  if (cohort?.role === 'worker') return session.title.trim() || cohort.slotLabel?.trim() || session.title;
  return session.title;
}
