/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { ModuleHost } from './host.js';
import { PrBoard } from './PrBoard.js';
import type { MonitoredPr, MonitoredRepo, PrRollupStatus } from '../../lib/types.js';
import { BOARD_COLUMNS } from './pr-board.js';

describe('PrBoard', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  function makeHost(): ModuleHost {
    return {
      call: async () => ({ ok: true, prs: [] }),
      cache: { get: () => null, set: () => {}, refreshBadge: () => {} },
      openExternal: () => {},
      toast: () => {},
      storage: { get: async () => null, set: async () => {} },
      listProjects: () => [],
    } as unknown as ModuleHost;
  }

  function makePr(status: PrRollupStatus, n: number, extra?: Partial<MonitoredPr>): MonitoredPr {
    return {
      url: `https://github.com/acme/webapp/pull/${n}`,
      repo: 'acme/webapp',
      number: n,
      title: `PR ${n}`,
      baseRefName: 'main',
      status,
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checks: [],
      addedAt: n,
      lastChecked: n,
      lastStatusChange: n,
      lastSeenAt: n,
      ...extra,
    };
  }

  function mount(
    prs: MonitoredPr[],
    over?: {
      showEmpty?: boolean;
      collapsed?: ReadonlySet<PrRollupStatus>;
      onToggleCollapse?: (status: PrRollupStatus) => void;
      selected?: Set<string>;
      repositories?: MonitoredRepo[];
      tisWarnHours?: number;
      tisDangerHours?: number;
    }
  ) {
    const { container } = render(
      <PrBoard
        prs={prs}
        host={makeHost()}
        selected={over?.selected ?? new Set()}
        showEmpty={over?.showEmpty}
        collapsed={over?.collapsed ?? new Set()}
        onToggleCollapse={over?.onToggleCollapse ?? (() => {})}
        onToggleSelect={() => {}}
        onDismiss={() => {}}
        onOpen={() => {}}
        repositories={over?.repositories}
        tisWarnHours={over?.tisWarnHours}
        tisDangerHours={over?.tisDangerHours}
      />
    );
    cleanup = () => container.remove();
    return container;
  }

  it('hides empty lanes by default', () => {
    const container = mount([makePr('green', 1)]);
    const cols = Array.from(container.querySelectorAll<HTMLElement>('[data-board-column]'));
    expect(cols.map((c) => c.getAttribute('data-board-column'))).toEqual(['green']);
    expect(container.querySelector('[data-board-column="failed"]')).toBeNull();
  });

  it('showEmpty paints every active column including empty ones', () => {
    const container = mount([makePr('green', 1)], { showEmpty: true });
    const cols = Array.from(container.querySelectorAll<HTMLElement>('[data-board-column]'));
    expect(cols.map((c) => c.getAttribute('data-board-column'))).toEqual([...BOARD_COLUMNS]);
    expect(container.querySelector('[data-board-column="failed"] .prm-board-col-empty')?.textContent).toBe('No PRs');
  });

  it('places cards in their status column', () => {
    const container = mount([makePr('green', 1), makePr('failed', 2), makePr('failed', 3)]);
    const ready = container.querySelector('[data-board-column="green"]');
    const failing = container.querySelector('[data-board-column="failed"]');
    expect(ready?.querySelectorAll('.prm-board-card').length).toBe(1);
    expect(failing?.querySelectorAll('.prm-board-card').length).toBe(2);
    expect(ready?.querySelector('.prm-board-col-count')?.textContent).toBe('1');
    expect(failing?.querySelector('.prm-board-col-count')?.textContent).toBe('2');
  });

  it('hides empty Merged and Closed columns and shows them once they have cards', () => {
    const emptyTerminal = mount([makePr('green', 1)]);
    expect(emptyTerminal.querySelector('[data-board-column="closed-merged"]')).toBeNull();
    expect(emptyTerminal.querySelector('[data-board-column="closed-abandoned"]')).toBeNull();
    cleanup?.();
    const withMerged = mount([makePr('green', 1), makePr('closed-merged', 2)]);
    expect(withMerged.querySelector('[data-board-column="closed-merged"]')).toBeTruthy();
    expect(withMerged.querySelector('[data-board-column="closed-abandoned"]')).toBeNull();
  });

  it('badges unread count on a column header', () => {
    const container = mount([
      makePr('green', 1, { lastSeenAt: 0, lastStatusChange: 10 }),
      makePr('green', 2, { lastSeenAt: 50, lastStatusChange: 10 }),
    ]);
    expect(container.querySelector('[data-board-column="green"] .prm-board-col-unread')?.textContent).toBe('1');
    expect(container.querySelector('[data-board-column="failed"] .prm-board-col-unread')).toBeNull();
  });

  it('treats a never-seen card as unread when lastSeenAt is omitted', () => {
    const container = mount([
      makePr('green', 1, { lastSeenAt: undefined, lastStatusChange: 10, addedAt: 1 }),
    ]);
    expect(container.querySelector('[data-board-column="green"] .prm-board-col-unread')?.textContent).toBe('1');
  });

  it('resolves per-repo ignore lists onto cards', () => {
    const container = mount(
      [
        makePr('failed', 1, {
          repo: 'acme/webapp',
          checks: [{ name: 'Snyk', state: 'FAILURE' }],
        }),
      ],
      {
        repositories: [
          {
            owner: 'acme',
            repo: 'webapp',
            host: 'github.com',
            orgLogin: 'acme',
            active: true,
            createdAt: 1,
            notifyInApp: true,
            ignoredFailingChecks: ['Snyk'],
          },
        ],
        tisWarnHours: 3,
        tisDangerHours: 5,
      }
    );
    expect(container.querySelector('.prm-board-card')).toBeTruthy();
    expect(container.querySelector('.prm-check-pip--fail')?.textContent).toContain('1');
  });

  it('collapses a column to a strip without cards', () => {
    const collapsed = new Set<PrRollupStatus>(['green']);
    const toggled: PrRollupStatus[] = [];
    const container = mount([makePr('green', 1), makePr('failed', 2)], {
      collapsed,
      onToggleCollapse: (status) => toggled.push(status),
    });
    const ready = container.querySelector('[data-board-column="green"]');
    expect(ready?.getAttribute('data-collapsed')).toBe('true');
    expect(ready?.querySelector('.prm-board-card')).toBeNull();
    expect(container.querySelector('[data-board-column="failed"]')?.getAttribute('data-collapsed')).toBe('false');
    fireEvent.click(ready!.querySelector<HTMLButtonElement>('.prm-board-col-collapse')!);
    expect(toggled).toEqual(['green']);
  });
});
