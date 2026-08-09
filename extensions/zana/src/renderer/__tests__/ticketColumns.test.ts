/**
 * Unit tests for the C2 ProjectTicketsView column / sort helpers — the pure
 * data transforms the kanban memos call. Zero-DOM (no jsdom/RTL in this repo);
 * the rendering shell is a thin projection over these tested helpers + the
 * already-tested B3 store (its IPC-storm de-dup is locked in
 * `src/renderer/__tests__/ticketsStore.test.ts`).
 */
import { describe, it, expect } from 'vitest';
import type { ZanaSnapshot, ZanaSprint, ZanaTicket } from '@shared/zana-types';
import {
  buildColumns,
  filterTickets,
  isSnapshotEmpty,
  isTerminalStatus,
  resolveSprintName,
  shortId,
  statusRank,
  substanceScore
} from '../ticketColumns';

function mkTicket(over: Partial<ZanaTicket> = {}): ZanaTicket {
  return { id: 't1', title: 'T', status: 'backlog', labels: [], blockedBy: [], ...over };
}

function snap(over: Partial<ZanaSnapshot> = {}): ZanaSnapshot {
  return {
    source: { kind: 'project', label: 'p', path: '/p/.zana' },
    kpis: {
      totalTickets: 0,
      openTickets: 0,
      closedTickets: 0,
      blockedTickets: 0,
      byStatus: {},
      byPriority: {},
      sprintCount: 0,
      artifactCount: 0
    },
    tickets: [],
    sprints: [],
    artifacts: [],
    isInitialized: true,
    ...over
  };
}

describe('statusRank', () => {
  it('orders known statuses by the canonical sequence (case/space-insensitive)', () => {
    expect(statusRank('backlog')).toBeLessThan(statusRank('in-progress'));
    expect(statusRank('in-progress')).toBeLessThan(statusRank('done'));
    expect(statusRank('  In-Progress  ')).toBe(statusRank('in-progress'));
  });

  it('ranks unknown statuses after every known one', () => {
    expect(statusRank('mystery')).toBeGreaterThan(statusRank('rejected'));
  });
});

describe('isTerminalStatus', () => {
  it('treats done/closed/completed/cancelled/canceled/rejected as terminal', () => {
    for (const s of ['done', 'Closed', 'COMPLETED', 'cancelled', 'canceled', 'rejected']) {
      expect(isTerminalStatus(s)).toBe(true);
    }
  });
  it('treats active statuses as non-terminal', () => {
    for (const s of ['backlog', 'in-progress', 'review', 'blocked']) {
      expect(isTerminalStatus(s)).toBe(false);
    }
  });
});

describe('shortId', () => {
  it('clips ids longer than 8 chars', () => {
    expect(shortId('abcdefghijkl')).toBe('abcdefgh');
    expect(shortId('abc')).toBe('abc');
  });
});

describe('resolveSprintName', () => {
  const sprints: ZanaSprint[] = [
    { id: 'realid01xxxx', name: 'Q3 Sprint' },
    { id: 'syntheticid1', name: 'Sprint syntheti' } // not the synthetic form
  ];
  it('returns the real name when set', () => {
    expect(resolveSprintName('realid01xxxx', sprints)).toBe('Q3 Sprint');
  });
  it('returns undefined for an unknown / unnamed / synthetic-named sprint', () => {
    expect(resolveSprintName(undefined, sprints)).toBeUndefined();
    expect(resolveSprintName('missing', sprints)).toBeUndefined();
    const synthetic: ZanaSprint[] = [{ id: 'abcd1234ef', name: 'Sprint abcd1234' }];
    expect(resolveSprintName('abcd1234ef', synthetic)).toBeUndefined();
  });
});

describe('substanceScore', () => {
  it('rewards real content and penalises test-fixture titles', () => {
    const real = mkTicket({ title: 'Build the thing', description: 'lots', sprintId: 's', labels: ['x'], assigneeName: 'Ada' });
    const fixture = mkTicket({ title: 'test-1778-claim' });
    expect(substanceScore(real)).toBeGreaterThan(substanceScore(fixture));
    expect(substanceScore(fixture)).toBeLessThan(0);
  });
});

describe('filterTickets', () => {
  const tickets = [
    mkTicket({ id: 'a', title: 'Fix login', labels: ['auth'], assigneeName: 'Ada' }),
    mkTicket({ id: 'b', title: 'Add logout', labels: ['auth'], sprintId: 's1' }),
    mkTicket({ id: 'c', title: 'Docs', labels: ['writing'], sprintId: 's2' })
  ];
  it('matches title, labels and assignee (case-insensitive)', () => {
    expect(filterTickets(tickets, 'login', null).map((t) => t.id)).toEqual(['a']);
    expect(filterTickets(tickets, 'AUTH', null).map((t) => t.id)).toEqual(['a', 'b']);
    expect(filterTickets(tickets, 'ada', null).map((t) => t.id)).toEqual(['a']);
  });
  it('honours a sprint filter (AND with the text query)', () => {
    expect(filterTickets(tickets, '', 's1').map((t) => t.id)).toEqual(['b']);
    expect(filterTickets(tickets, 'logout', 's2')).toEqual([]);
  });
  it('returns all tickets for an empty query + no sprint filter', () => {
    expect(filterTickets(tickets, '   ', null)).toHaveLength(3);
  });
});

describe('buildColumns', () => {
  it('groups by status and orders columns by statusRank, unknowns trailing', () => {
    const tickets = [
      mkTicket({ id: 'd', status: 'done' }),
      mkTicket({ id: 'b', status: 'backlog' }),
      mkTicket({ id: 'p', status: 'in-progress' }),
      mkTicket({ id: 'z', status: 'mystery' })
    ];
    expect(buildColumns(tickets).map(([s]) => s)).toEqual([
      'backlog',
      'in-progress',
      'done',
      'mystery'
    ]);
  });

  it('ranks substantive tickets above bare test fixtures within a column', () => {
    const tickets = [
      mkTicket({ id: 'fix', status: 'backlog', title: 'test ticket' }),
      mkTicket({ id: 'real', status: 'backlog', title: 'Real work', description: 'yes' })
    ];
    const [[, items]] = buildColumns(tickets);
    expect(items.map((t) => t.id)).toEqual(['real', 'fix']);
  });

  it('uses "unknown" for a blank status', () => {
    expect(buildColumns([mkTicket({ status: '' })]).map(([s]) => s)).toEqual(['unknown']);
  });
});

describe('isSnapshotEmpty', () => {
  it('is false for a null snapshot (not yet loaded)', () => {
    expect(isSnapshotEmpty(null)).toBe(false);
  });
  it('is true only when tickets, sprints and artifacts are all empty', () => {
    expect(isSnapshotEmpty(snap())).toBe(true);
    expect(isSnapshotEmpty(snap({ tickets: [mkTicket()] }))).toBe(false);
    expect(isSnapshotEmpty(snap({ sprints: [{ id: 's' }] }))).toBe(false);
    expect(
      isSnapshotEmpty(
        snap({ artifacts: [{ id: 'a', title: 'A', content: '', tags: [], linkedTickets: [] }] })
      )
    ).toBe(false);
  });
  it('ignores all-zero kpis when arrays hold data (array-derived, not kpi-derived)', () => {
    // kpis all-zero but a ticket present → NOT empty.
    expect(isSnapshotEmpty(snap({ tickets: [mkTicket()] }))).toBe(false);
  });
});
