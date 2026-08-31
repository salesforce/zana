import { describe, it, expect } from 'vitest';
import type { ScheduledTask, TerminalSession } from '@zana-ai/zcc-domain/product';
import {
  isIdleAgent,
  isBackgroundAgent,
  isReclaimableIdle,
  cardNeedsAttention,
  LANES,
  visibleAgentLanes,
  groupCardsByProject,
  partitionSquads,
  scheduleBySessionId,
  formatCountdown,
  type AgentCard
} from '../components/AgentBoard.js';

/**
 * The Idle lane collects every at-rest live agent. Close-idle is narrower:
 * {@link isReclaimableIdle} spares parents with live sub-agents so bulk-close
 * never orphans Task spawns (mirrors the main-side auto-close-idle spare).
 */

function card(over: Partial<AgentCard> & { state: AgentCard['state'] }): AgentCard {
  const session = {
    id: 's1',
    status: 'running',
    profile: 'claude'
  } as unknown as TerminalSession;
  return {
    session,
    projectId: 'p1',
    projectName: 'P1',
    liveSubagents: 0,
    ...over
  };
}

describe('Idle lane predicates', () => {
  it('an at-rest agent with no sub-agents is Idle', () => {
    const c = card({ state: 'idle' });
    expect(isIdleAgent(c)).toBe(true);
  });

  it('an at-rest agent with live sub-agents is still Idle (no Delegating lane)', () => {
    const c = card({ state: 'idle', liveSubagents: 3 });
    expect(isIdleAgent(c)).toBe(true);
    expect(isReclaimableIdle(c)).toBe(false); // never a close-idle target
  });

  it('an unknown-state agent with sub-agents is Idle too', () => {
    const c = card({ state: 'unknown', liveSubagents: 1 });
    expect(isIdleAgent(c)).toBe(true);
    expect(isReclaimableIdle(c)).toBe(false);
  });

  it('a working agent is not Idle even with sub-agents', () => {
    const c = card({ state: 'working', liveSubagents: 2 });
    expect(isIdleAgent(c)).toBe(false);
  });

  it('a blocked agent is not Idle, even with sub-agents', () => {
    const c = card({ state: 'blocked', liveSubagents: 2 });
    expect(isIdleAgent(c)).toBe(false);
  });

  it('an exited session is not Idle, regardless of stale sub-agent count', () => {
    const session = { id: 's1', status: 'exited', profile: 'claude' } as unknown as TerminalSession;
    const c: AgentCard = { session, state: 'idle', projectId: 'p1', projectName: 'P1', liveSubagents: 2 };
    expect(isIdleAgent(c)).toBe(false);
  });

  it('LANES has no Delegating column', () => {
    expect(LANES.map((l) => l.key)).toEqual(['blocked', 'working', 'scheduled', 'idle', 'done']);
  });

  it('hides the Scheduled column unless includeScheduled is on', () => {
    expect(visibleAgentLanes(false).map((l) => l.key)).toEqual(['blocked', 'working', 'idle', 'done']);
    expect(visibleAgentLanes(true).map((l) => l.key)).toEqual([
      'blocked',
      'working',
      'scheduled',
      'idle',
      'done'
    ]);
  });
});

/**
 * "Close & follow up" targets {@link isReclaimableIdle}: idle agents that are
 * NOT parked on a question and NOT background — a live question must never be
 * dropped on the floor by a bulk reclaim, and background workers never surface.
 */
describe('isReclaimableIdle (Close & follow-up target)', () => {
  it('a plain idle agent with no triage is reclaimable', () => {
    expect(isReclaimableIdle(card({ state: 'idle' }))).toBe(true);
  });

  it('an idle agent parked on a question is NOT reclaimable', () => {
    const c = card({
      state: 'idle',
      triage: { sessionId: 's1', at: 0, resolution: 'awaiting-reply', confidence: 0.9, summary: 'q?' }
    });
    expect(isReclaimableIdle(c)).toBe(false);
  });

  it('an idle agent triaged done/paused IS reclaimable', () => {
    for (const resolution of ['done', 'paused', 'unknown'] as const) {
      const c = card({
        state: 'idle',
        triage: { sessionId: 's1', at: 0, resolution, summary: 's' }
      });
      expect(isReclaimableIdle(c)).toBe(true);
    }
  });

  it('working, blocked, and parents with live sub-agents are never reclaimable', () => {
    expect(isReclaimableIdle(card({ state: 'working' }))).toBe(false);
    expect(isReclaimableIdle(card({ state: 'blocked' }))).toBe(false);
    expect(isReclaimableIdle(card({ state: 'idle', liveSubagents: 2 }))).toBe(false);
  });
});

/**
 * Background agents (team WORKERS, launched headless, and scheduled runs) must
 * NEVER request the user's attention: the "Needs you" lane should pass them by
 * whether they're blocked (permission prompt) or carry a triage verdict. The
 * user fields only the orchestrator. These guard that contract — the bug being:
 * a team worker popped into "Needs you" and the user had to deal with it.
 */
function bgWorker(state: AgentCard['state'], over: Partial<AgentCard> = {}): AgentCard {
  const session = {
    id: 'w1',
    status: 'running',
    profile: 'claude',
    headless: true,
    cohort: { cohortId: 'co1', teamId: 't1', teamName: 'Review Squad', role: 'worker' }
  } as unknown as TerminalSession;
  return { session, state, projectId: 'p1', projectName: 'P1', liveSubagents: 0, ...over };
}

const needsYou = LANES.find((l) => l.key === 'blocked')!;
const working = LANES.find((l) => l.key === 'working')!;
const scheduledLane = LANES.find((l) => l.key === 'scheduled')!;
const idleLane = LANES.find((l) => l.key === 'idle')!;

function scheduledRun(state: AgentCard['state']): AgentCard {
  const session = {
    id: 'sch1',
    status: 'running',
    profile: 'claude',
    scheduled: true,
    headless: true
  } as unknown as TerminalSession;
  return { session, state, projectId: 'p1', projectName: 'P1', liveSubagents: 0 };
}

describe('scheduled agents in Agent View lanes', () => {
  it('waiting scheduled jobs sit in Scheduled, not Idle', () => {
    expect(scheduledLane.match(scheduledRun('idle'))).toBe(true);
    expect(idleLane.match(scheduledRun('idle'))).toBe(false);
    expect(scheduledLane.match(scheduledRun('unknown'))).toBe(true);
  });

  it('working scheduled jobs use Working', () => {
    expect(working.match(scheduledRun('working'))).toBe(true);
    expect(scheduledLane.match(scheduledRun('working'))).toBe(false);
  });

  it('blocked scheduled jobs stay in Working, not Needs you', () => {
    expect(needsYou.match(scheduledRun('blocked'))).toBe(false);
    expect(working.match(scheduledRun('blocked'))).toBe(true);
    expect(scheduledLane.match(scheduledRun('blocked'))).toBe(false);
  });
});

describe('background agents never reach the "Needs you" lane', () => {
  it('isBackgroundAgent is true for a headless worker, false for a plain agent', () => {
    expect(isBackgroundAgent(bgWorker('idle'))).toBe(true);
    expect(isBackgroundAgent(card({ state: 'blocked' }))).toBe(false);
  });

  it('a BLOCKED foreground agent surfaces in "Needs you" (unchanged)', () => {
    expect(needsYou.match(card({ state: 'blocked' }), 'medium')).toBe(true);
  });

  it('a BLOCKED background worker does NOT surface in "Needs you"', () => {
    expect(needsYou.match(bgWorker('blocked'), 'medium')).toBe(false);
  });

  it('a blocked background worker is shown in Working instead (never vanishes)', () => {
    expect(working.match(bgWorker('blocked'))).toBe(true);
  });

  it('a triaged idle background worker is not promoted to "Needs you"', () => {
    const triaged = bgWorker('idle', {
      triage: { sessionId: 'w1', at: 0, resolution: 'awaiting-reply', confidence: 0.95, summary: 'q?' }
    });
    expect(cardNeedsAttention(triaged, 'high')).toBe(false);
    expect(needsYou.match(triaged, 'high')).toBe(false);
  });

  it('the SAME triage on a foreground agent still surfaces (control)', () => {
    const fg = card({
      state: 'idle',
      triage: { sessionId: 's1', at: 0, resolution: 'awaiting-reply', confidence: 0.95, summary: 'q?' }
    });
    expect(cardNeedsAttention(fg, 'medium')).toBe(true);
  });
});

/**
 * groupCardsByProject backs the global board's per-project grouping inside each
 * lane. The contract that matters for the UI: a project's group lands at the
 * position of its FIRST card (so a pre-sorted lane — e.g. idle's
 * most-recently-idle-first — keeps that order across groups), and a card's
 * order WITHIN its group is preserved.
 */
function projCard(
  id: string,
  projectId: string,
  over: Partial<AgentCard> = {}
): AgentCard {
  const session = { id, status: 'running', profile: 'claude' } as unknown as TerminalSession;
  return {
    session,
    state: 'idle',
    projectId,
    projectName: projectId.toUpperCase(),
    liveSubagents: 0,
    ...over
  };
}

describe('groupCardsByProject', () => {
  it('returns an empty array for no cards', () => {
    expect(groupCardsByProject([])).toEqual([]);
  });

  it('groups cards by project id', () => {
    const groups = groupCardsByProject([
      projCard('a', 'p1'),
      projCard('b', 'p2'),
      projCard('c', 'p1')
    ]);
    expect(groups.map((g) => g.projectId)).toEqual(['p1', 'p2']);
    expect(groups[0].cards.map((c) => c.session.id)).toEqual(['a', 'c']);
    expect(groups[1].cards.map((c) => c.session.id)).toEqual(['b']);
  });

  it('orders groups by each project’s first-seen card (preserves lane order)', () => {
    // p2 appears first in the input, so its group must lead — even though p1
    // has more cards. This is what keeps a pre-sorted lane’s order intact.
    const groups = groupCardsByProject([
      projCard('a', 'p2'),
      projCard('b', 'p1'),
      projCard('c', 'p1')
    ]);
    expect(groups.map((g) => g.projectId)).toEqual(['p2', 'p1']);
  });

  it('carries projectName and projectColor from the first card of each group', () => {
    const groups = groupCardsByProject([
      projCard('a', 'p1', { projectName: 'Alpha', projectColor: '#abc' }),
      projCard('b', 'p1', { projectName: 'IGNORED', projectColor: '#fff' })
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].projectName).toBe('Alpha');
    expect(groups[0].projectColor).toBe('#abc');
  });

  it('every input card lands in exactly one group (no drops, no dupes)', () => {
    const cards = [
      projCard('a', 'p1'),
      projCard('b', 'p2'),
      projCard('c', 'p1'),
      projCard('d', 'p3'),
      projCard('e', 'p2')
    ];
    const groups = groupCardsByProject(cards);
    const total = groups.reduce((n, g) => n + g.cards.length, 0);
    expect(total).toBe(cards.length);
    const ids = groups.flatMap((g) => g.cards.map((c) => c.session.id)).sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

/**
 * scheduleBySessionId backs the per-card "next run in X" chip: it inverts each
 * schedule's run history (the only link from a session back to its owning
 * schedule — there's no scheduleId on the session) so a scheduled card can find
 * the schedule that fired it and show its countdown.
 */
function sched(id: string, sessionIds: string[], over: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id,
    name: id,
    enabled: true,
    projectId: 'p1',
    profile: 'claude',
    schedule: { every: '1h' },
    overlap: 'skip',
    history: { retain: 10 },
    status: { runCount: sessionIds.length, runs: sessionIds.map((sid) => ({ at: '', result: 'success', sessionId: sid })) },
    createdAt: '',
    updatedAt: '',
    ...over
  } as ScheduledTask;
}

describe('scheduleBySessionId', () => {
  it('maps each fired session id to its owning schedule', () => {
    const a = sched('a', ['s1', 's2']);
    const b = sched('b', ['s3']);
    const map = scheduleBySessionId([a, b]);
    expect(map.get('s1')).toBe(a);
    expect(map.get('s2')).toBe(a);
    expect(map.get('s3')).toBe(b);
    expect(map.get('s4')).toBeUndefined();
  });

  it('ignores run records with no sessionId (skipped fires)', () => {
    const a: ScheduledTask = sched('a', []);
    a.status.runs = [{ at: '', result: 'skipped' }, { at: '', result: 'success', sessionId: 's1' }];
    const map = scheduleBySessionId([a]);
    expect(map.get('s1')).toBe(a);
    expect(map.size).toBe(1);
  });

  it('newest run wins when a session id appears under two schedules', () => {
    // status.runs is newest-first; the first schedule listed claims it first.
    const a = sched('a', ['shared']);
    const b = sched('b', ['shared']);
    expect(scheduleBySessionId([a, b]).get('shared')).toBe(a);
  });

  it('a Claude /loop row (no run history) contributes nothing', () => {
    const loop = sched('claude-loop:x', [], { external: { kind: 'claude-loop', cron: '*/5 * * * *' } });
    expect(scheduleBySessionId([loop]).size).toBe(0);
  });
});

/**
 * partitionSquads collapses each launched team into ONE board card: a cohort
 * with a live orchestrator keeps only that card in the lanes, with every other
 * member nested under it (workersByOrchestrator). Cohorts with no live
 * orchestrator, and all solo agents, are left in the lanes untouched — so a
 * headless worker fleet with no driver never silently vanishes.
 */
function memberCard(
  id: string,
  cohortId: string | null,
  role: 'orchestrator' | 'worker' | null,
  over: Partial<AgentCard> = {}
): AgentCard {
  const session = {
    id,
    status: 'running',
    profile: 'claude',
    ...(cohortId && role
      ? { cohort: { cohortId, teamId: 't1', teamName: 'Squad', role } }
      : {})
  } as unknown as TerminalSession;
  return { session, state: 'working', projectId: 'p1', projectName: 'P1', liveSubagents: 0, ...over };
}

describe('partitionSquads', () => {
  it('leaves solo (non-cohort) agents untouched', () => {
    const cards = [memberCard('a', null, null), memberCard('b', null, null)];
    const { laneCards, workersByOrchestrator } = partitionSquads(cards);
    expect(laneCards.map((c) => c.session.id)).toEqual(['a', 'b']);
    expect(workersByOrchestrator.size).toBe(0);
  });

  it('nests workers under a live orchestrator, keeping only the orch in the lanes', () => {
    const cards = [
      memberCard('orch', 'co1', 'orchestrator'),
      memberCard('w1', 'co1', 'worker'),
      memberCard('w2', 'co1', 'worker')
    ];
    const { laneCards, workersByOrchestrator } = partitionSquads(cards);
    expect(laneCards.map((c) => c.session.id)).toEqual(['orch']);
    expect(workersByOrchestrator.get('orch')?.map((c) => c.session.id)).toEqual(['w1', 'w2']);
  });

  it('nests exited workers too (the squad reads as one unit)', () => {
    const dead = memberCard('w1', 'co1', 'worker');
    (dead.session as { status: string }).status = 'exited';
    const cards = [memberCard('orch', 'co1', 'orchestrator'), dead];
    const { laneCards, workersByOrchestrator } = partitionSquads(cards);
    expect(laneCards.map((c) => c.session.id)).toEqual(['orch']);
    expect(workersByOrchestrator.get('orch')?.map((c) => c.session.id)).toEqual(['w1']);
  });

  it('leaves a driverless worker fleet in the lanes (no live orchestrator)', () => {
    // Orchestrator exited → can no longer host; workers must not vanish.
    const deadOrch = memberCard('orch', 'co1', 'orchestrator');
    (deadOrch.session as { status: string }).status = 'exited';
    const cards = [deadOrch, memberCard('w1', 'co1', 'worker'), memberCard('w2', 'co1', 'worker')];
    const { laneCards, workersByOrchestrator } = partitionSquads(cards);
    expect(laneCards.map((c) => c.session.id).sort()).toEqual(['orch', 'w1', 'w2']);
    expect(workersByOrchestrator.size).toBe(0);
  });

  it('keeps two cohorts independent', () => {
    const cards = [
      memberCard('o1', 'co1', 'orchestrator'),
      memberCard('a', 'co1', 'worker'),
      memberCard('o2', 'co2', 'orchestrator'),
      memberCard('b', 'co2', 'worker')
    ];
    const { laneCards, workersByOrchestrator } = partitionSquads(cards);
    expect(laneCards.map((c) => c.session.id)).toEqual(['o1', 'o2']);
    expect(workersByOrchestrator.get('o1')?.map((c) => c.session.id)).toEqual(['a']);
    expect(workersByOrchestrator.get('o2')?.map((c) => c.session.id)).toEqual(['b']);
  });

  it('every input card is accounted for exactly once (lane + nested, no drops)', () => {
    const cards = [
      memberCard('o1', 'co1', 'orchestrator'),
      memberCard('a', 'co1', 'worker'),
      memberCard('solo', null, null)
    ];
    const { laneCards, workersByOrchestrator } = partitionSquads(cards);
    const nested = [...workersByOrchestrator.values()].flat();
    const all = [...laneCards, ...nested].map((c) => c.session.id).sort();
    expect(all).toEqual(['a', 'o1', 'solo']);
  });

  it('preserves input order for lane cards and nested workers', () => {
    const cards = [
      memberCard('o1', 'co1', 'orchestrator'),
      memberCard('w2', 'co1', 'worker'),
      memberCard('w1', 'co1', 'worker')
    ];
    const { workersByOrchestrator } = partitionSquads(cards);
    // Workers keep their incoming order (w2 before w1), not sorted.
    expect(workersByOrchestrator.get('o1')?.map((c) => c.session.id)).toEqual(['w2', 'w1']);
  });
});

describe('formatCountdown', () => {
  it('clamps a past/now target to "now"', () => {
    expect(formatCountdown(0)).toBe('now');
    expect(formatCountdown(-5000)).toBe('now');
  });

  it('formats sub-minute, sub-hour, and hour+ spans', () => {
    expect(formatCountdown(42_000)).toBe('42s');
    expect(formatCountdown(90_000)).toBe('1m 30s');
    expect(formatCountdown(3_660_000)).toBe('1h 1m');
  });
});
