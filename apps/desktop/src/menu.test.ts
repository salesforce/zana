import { describe, it, expect, vi, beforeEach } from 'vitest';

// The controller imports electron for the popover window, but buildSnapshot /
// badgeCount never touch it — mock the surface so the module loads under vitest.
vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: {},
  Tray: class {}
}));
import { MenubarController, isRepliable, type MenubarDeps } from './menu.js';
import type { AgentState, IdleTriageResult, TerminalSession } from '@zana-ai/zcc-domain/product';

function session(over: Partial<TerminalSession> & { id: string }): TerminalSession {
  return {
    projectId: 'p1',
    title: over.id,
    profile: 'claude',
    cwd: '/tmp',
    status: 'running',
    createdAt: 1_000,
    ...over
  } as TerminalSession;
}

function makeController(opts: {
  sessions: TerminalSession[];
  states: Record<string, AgentState>;
  favorites?: Set<string>;
  schedules?: Array<{ projectId: string; enabled: boolean; nextRunAt?: string }>;
  triage?: Record<string, IdleTriageResult>;
}) {
  const deps: MenubarDeps = {
    ptys: {
      listAll: () => opts.sessions,
      getSession: (id: string) => opts.sessions.find((s) => s.id === id) ?? null
    } as unknown as MenubarDeps['ptys'],
    agentStatus: {
      get: (id: string) => opts.states[id] ?? 'unknown'
    } as unknown as MenubarDeps['agentStatus'],
    scheduler: {
      list: () =>
        (opts.schedules ?? []).map((s, i) => ({
          id: `t${i}`,
          projectId: s.projectId,
          enabled: s.enabled,
          status: { nextRunAt: s.nextRunAt, runs: [] }
        }))
    } as unknown as MenubarDeps['scheduler'],
    projectName: (id) => `name-${id}`,
    projectColor: (id) => (id === 'p1' ? '#abc' : undefined),
    isFavorite: (id) => opts.favorites?.has(id) ?? false,
    triage: (id) => opts.triage?.[id] ?? null,
    theme: () => 'dark',
    preloadPath: '/preload.js'
  };
  return new MenubarController(deps);
}

describe('MenubarController.buildSnapshot', () => {
  it('surfaces only blocked/working/done and sorts attention-first', () => {
    const c = makeController({
      sessions: [
        session({ id: 'w', title: 'Working one' }),
        session({ id: 'b', title: 'Blocked one' }),
        session({ id: 'idle' }),
        session({ id: 'd', title: 'Done one' })
      ],
      states: { w: 'working', b: 'blocked', idle: 'idle', d: 'done' }
    });
    const snap = c.buildSnapshot();
    expect(snap.agents.map((a) => a.sessionId)).toEqual(['b', 'w', 'd']);
    expect(snap.needsYou).toBe(1);
    expect(snap.working).toBe(1);
  });

  it('excludes exited sessions from the fleet', () => {
    const c = makeController({
      sessions: [session({ id: 'x', status: 'exited' }), session({ id: 'w' })],
      states: { x: 'blocked', w: 'working' }
    });
    const snap = c.buildSnapshot();
    expect(snap.agents.map((a) => a.sessionId)).toEqual(['w']);
    expect(snap.needsYou).toBe(0);
  });

  it('stamps favorite + project chip from deps', () => {
    const c = makeController({
      sessions: [session({ id: 'b' })],
      states: { b: 'blocked' },
      favorites: new Set(['b'])
    });
    const [row] = c.buildSnapshot().agents;
    expect(row.favorite).toBe(true);
    expect(row.projectName).toBe('name-p1');
    expect(row.projectColor).toBe('#abc');
  });

  it('enriches ONLY blocked rows with the cached triage question + resolution', () => {
    const triage: Record<string, IdleTriageResult> = {
      b: {
        sessionId: 'b',
        resolution: 'awaiting-reply',
        summary: 'Apply the migration to prod?',
        at: 1
      },
      w: {
        sessionId: 'w',
        resolution: 'done',
        summary: 'should not appear (working)',
        at: 1
      }
    };
    const c = makeController({
      sessions: [session({ id: 'b' }), session({ id: 'w' })],
      states: { b: 'blocked', w: 'working' },
      triage
    });
    const rows = c.buildSnapshot().agents;
    const b = rows.find((r) => r.sessionId === 'b')!;
    const w = rows.find((r) => r.sessionId === 'w')!;
    expect(b.question).toBe('Apply the migration to prod?');
    expect(b.resolution).toBe('awaiting-reply');
    // A working agent never carries a question, even if a stale verdict is cached.
    expect(w.question).toBeUndefined();
    expect(w.resolution).toBeUndefined();
  });

  it('leaves the question absent when no verdict is cached (graceful degrade)', () => {
    const c = makeController({ sessions: [session({ id: 'b' })], states: { b: 'blocked' } });
    const [row] = c.buildSnapshot().agents;
    expect(row.question).toBeUndefined();
    expect(row.resolution).toBeUndefined();
  });

  it('marks foreground agents repliable and background (scheduled/headless) not', () => {
    const c = makeController({
      sessions: [
        session({ id: 'fg' }),
        session({ id: 'sched', scheduled: true }),
        session({ id: 'hidden', headless: true })
      ],
      states: { fg: 'blocked', sched: 'blocked', hidden: 'blocked' }
    });
    const rows = c.buildSnapshot().agents;
    expect(rows.find((r) => r.sessionId === 'fg')!.repliable).toBe(true);
    expect(rows.find((r) => r.sessionId === 'sched')!.repliable).toBe(false);
    expect(rows.find((r) => r.sessionId === 'hidden')!.repliable).toBe(false);
  });

  it('reports the soonest ENABLED next run, ignoring paused schedules', () => {
    const c = makeController({
      sessions: [],
      states: {},
      schedules: [
        { projectId: 'p1', enabled: false, nextRunAt: '2020-01-01T00:00:00.000Z' },
        { projectId: 'p1', enabled: true, nextRunAt: '2030-06-01T10:00:00.000Z' },
        { projectId: 'p1', enabled: true, nextRunAt: '2030-01-01T10:00:00.000Z' }
      ]
    });
    const snap = c.buildSnapshot();
    expect(snap.scheduleCount).toBe(3);
    expect(snap.nextRunAt).toBe('2030-01-01T10:00:00.000Z');
  });
});

describe('MenubarController.badgeCount', () => {
  it('tallies blocked and working across the live fleet', () => {
    const c = makeController({
      sessions: [
        session({ id: 'b1' }),
        session({ id: 'b2' }),
        session({ id: 'w1' }),
        session({ id: 'idle' })
      ],
      states: { b1: 'blocked', b2: 'blocked', w1: 'working', idle: 'idle' }
    });
    expect(c.badgeCount()).toEqual({ needsYou: 2, working: 1 });
  });
});

describe('isRepliable', () => {
  it('accepts a foreground interactive session', () => {
    expect(isRepliable(session({ id: 'a' }))).toBe(true);
  });
  it('refuses scheduled (background) sessions', () => {
    expect(isRepliable(session({ id: 'a', scheduled: true }))).toBe(false);
  });
  it('refuses headless (hidden) sessions', () => {
    expect(isRepliable(session({ id: 'a', headless: true }))).toBe(false);
  });
});
