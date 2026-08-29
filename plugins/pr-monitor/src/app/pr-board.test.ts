import { describe, expect, it } from 'vitest';
import type { MonitoredPr, PrRollupStatus } from '../../lib/types.js';
import {
  BOARD_COLUMN_LABELS,
  BOARD_COLUMNS,
  boardColumnCounts,
  emptyActiveColumnCount,
  emptyBoardColumns,
  groupPrsByStatus,
  isListViewMode,
  isPrRollupStatus,
  shortRepoName,
  TERMINAL_BOARD_COLUMNS,
  visibleBoardColumns,
} from './pr-board.js';

const NOW = 1_700_000_000_000;

function makePr(partial?: Partial<MonitoredPr>): MonitoredPr {
  return {
    url: `https://github.com/owner/repo/pull/${partial?.number ?? 1}`,
    repo: 'owner/repo',
    number: 1,
    title: 'A change',
    baseRefName: 'main',
    status: 'green',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    checks: [],
    addedAt: NOW,
    lastChecked: NOW,
    lastStatusChange: NOW,
    ...partial,
  };
}

describe('isListViewMode', () => {
  it('accepts list and board', () => {
    expect(isListViewMode('list')).toBe(true);
    expect(isListViewMode('board')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isListViewMode('prs')).toBe(false);
    expect(isListViewMode('settings')).toBe(false);
    expect(isListViewMode(null)).toBe(false);
    expect(isListViewMode(undefined)).toBe(false);
  });
});

describe('groupPrsByStatus', () => {
  it('places each PR in its rollup column and preserves input order', () => {
    const prs = [
      makePr({ number: 1, status: 'failed', title: 'first-fail' }),
      makePr({ number: 2, status: 'green', title: 'ready' }),
      makePr({ number: 3, status: 'failed', title: 'second-fail' }),
    ];
    const grouped = groupPrsByStatus(prs);
    expect(grouped.failed.map((p) => p.title)).toEqual(['first-fail', 'second-fail']);
    expect(grouped.green.map((p) => p.title)).toEqual(['ready']);
    expect(grouped.pending).toEqual([]);
  });

  it('starts from empty lanes for every status', () => {
    const empty = emptyBoardColumns();
    for (const status of [...BOARD_COLUMNS, ...TERMINAL_BOARD_COLUMNS]) {
      expect(empty[status]).toEqual([]);
    }
  });
});

describe('visibleBoardColumns', () => {
  it('hides empty lanes by default', () => {
    const columns = emptyBoardColumns();
    expect(visibleBoardColumns(columns)).toEqual([]);
    expect(visibleBoardColumns(groupPrsByStatus([makePr({ status: 'green' })]))).toEqual(['green']);
  });

  it('showEmpty restores the seven active columns and still hides empty terminal', () => {
    const columns = groupPrsByStatus([makePr({ status: 'green' })]);
    expect(visibleBoardColumns(columns, { showEmpty: true })).toEqual([...BOARD_COLUMNS]);
  });

  it('appends Merged / Closed only when they hold cards', () => {
    const columns = groupPrsByStatus([
      makePr({ number: 1, status: 'closed-merged' }),
      makePr({ number: 2, status: 'green' }),
    ]);
    expect(visibleBoardColumns(columns)).toEqual(['green', 'closed-merged']);
    expect(visibleBoardColumns(columns, { showEmpty: true })).toEqual([...BOARD_COLUMNS, 'closed-merged']);

    columns['closed-abandoned'].push(makePr({ number: 3, status: 'closed-abandoned' }));
    expect(visibleBoardColumns(columns)).toEqual(['green', 'closed-merged', 'closed-abandoned']);
  });
});

describe('emptyActiveColumnCount', () => {
  it('counts empty workflow columns', () => {
    const columns = groupPrsByStatus([makePr({ status: 'failed' }), makePr({ number: 2, status: 'green' })]);
    expect(emptyActiveColumnCount(columns)).toBe(BOARD_COLUMNS.length - 2);
  });
});

describe('isPrRollupStatus', () => {
  it('accepts rollup statuses only', () => {
    expect(isPrRollupStatus('failed')).toBe(true);
    expect(isPrRollupStatus('board')).toBe(false);
    expect(isPrRollupStatus(1)).toBe(false);
  });
});

describe('boardColumnCounts', () => {
  it('counts PRs per status', () => {
    const columns = groupPrsByStatus([
      makePr({ number: 1, status: 'failed' }),
      makePr({ number: 2, status: 'failed' }),
      makePr({ number: 3, status: 'green' }),
    ]);
    const counts = boardColumnCounts(columns);
    expect(counts.failed).toBe(2);
    expect(counts.green).toBe(1);
    expect(counts.pending).toBe(0);
  });
});

describe('BOARD_COLUMN_LABELS', () => {
  it('names every rollup status with a short column label', () => {
    const statuses: PrRollupStatus[] = [
      'conflict',
      'failed',
      'yellow',
      'review-required',
      'pending',
      'integrating',
      'green',
      'closed-merged',
      'closed-abandoned',
    ];
    for (const status of statuses) {
      expect(BOARD_COLUMN_LABELS[status].length).toBeGreaterThan(0);
      expect(BOARD_COLUMN_LABELS[status].length).toBeLessThan(12);
    }
  });
});

describe('shortRepoName', () => {
  it('returns the trailing segment', () => {
    expect(shortRepoName('acme/webapp')).toBe('webapp');
    expect(shortRepoName('webapp')).toBe('webapp');
  });
});
