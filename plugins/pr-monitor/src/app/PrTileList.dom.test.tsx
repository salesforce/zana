/**
 * @vitest-environment happy-dom
 *
 * PrTileList DOM tests — the list toolbar and its list-requirements ACs:
 *  - segment tabs (All + one per status)            AC-LIST-5.1/5.2/5.3
 *  - selection model + bulk-action bar              AC-LIST-6.1…6.7
 *  - shown count + unread count                     AC-LIST-7.1/7.2
 *  - quick search over the exact seven fields       AC-LIST-8.1/8.2/8.3
 *  - sort control (four fields, asc/desc, persist)  AC-LIST-9.1…9.4
 *  - mark-read toolbar action                       AC-LIST-10.2/10.3/10.5
 *  - three-way empty states                         AC-LIST-24.0/24.1/24.2
 */

import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import type { ModuleHost, ProjectInfo } from './host.js';
import { PrTileList, resolveBulkFavorite, compareFavoritesFirst, type SortField, type SortDir } from './PrTileList.js';
import type { MonitoredPr, PrRollupStatus } from '../../lib/types.js';

const PROJECTS: ProjectInfo[] = [{ id: 'proj-a', name: 'Alpha', path: '/repos/alpha' }];

function makeHost(): ModuleHost {
  return {
    call: async () => ({ ok: false }),
    cache: { get: () => null, set: () => {}, refreshBadge: () => {} },
    openExternal: () => {},
    toast: () => {},
    storage: { get: async () => null, set: async () => {} },
    listProjects: () => PROJECTS,
    getScopedProjectId: () => null,
  } as unknown as ModuleHost;
}

const NOW = 1_700_000_000_000;

function makePr(partial?: Partial<MonitoredPr>): MonitoredPr {
  return {
    url: `https://github.com/owner/repo/pull/${partial?.number ?? 1}`,
    repo: 'owner/repo',
    number: 1,
    title: 'A change',
    baseRefName: 'main',
    headRefName: 'feature/x',
    status: 'green',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    checks: [],
    addedAt: NOW - 10_000,
    lastChecked: NOW,
    lastStatusChange: NOW - 5_000,
    createdAt: NOW - 3_600_000,
    lastSeenAt: NOW, // seen by default
    author: { login: 'octocat', name: 'Octo Cat' },
    isDraft: false,
    source: 'manual',
    ...partial,
  };
}

/** Base props with no-op callbacks; spread + override per test. */
function baseProps(prs: MonitoredPr[], over?: Partial<React.ComponentProps<typeof PrTileList>>) {
  const props: React.ComponentProps<typeof PrTileList> = {
    prs,
    host: makeHost(),
    projects: PROJECTS,
    sortField: 'updated' as SortField,
    sortDir: 'desc' as SortDir,
    onSortChange: () => {},
    hostScope: [],
    onHostScopeChange: () => {},
    awaitingFirstSync: false,
    syncing: false,
    autoSyncEnabled: true,
    onDismiss: () => {},
    onProjectAssign: () => {},
    onBulkSetSeen: () => {},
    onBulkDismiss: () => {},
    onBulkSetFavorite: () => {},
    ...over,
  };
  return props;
}

describe('PrTileList toolbar', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
    document.querySelectorAll('.prm-tile-menu, .modal-backdrop').forEach((m) => m.remove());
  });

  // --- Empty states (AC-LIST-24.0/24.1/24.2) ---

  it('shows the pre-first-sync "checking" empty state while awaiting first sync', () => {
    const { container } = render(<PrTileList {...baseProps([], { awaitingFirstSync: true, syncing: true })} />);
    cleanup = () => container.remove();
    const empty = container.querySelector('.prm-empty');
    expect(empty?.querySelector('h3')?.textContent).toBe('Checking for your PRs…');
  });

  it('shows "No sync yet" when awaiting first sync but auto-sync off and idle', () => {
    const { container } = render(
      <PrTileList {...baseProps([], { awaitingFirstSync: true, syncing: false, autoSyncEnabled: false })} />
    );
    cleanup = () => container.remove();
    expect(container.querySelector('.prm-empty h3')?.textContent).toBe('No sync yet');
  });

  it('shows the nothing-monitored empty state after a completed sync with no PRs', () => {
    const { container } = render(<PrTileList {...baseProps([], { awaitingFirstSync: false })} />);
    cleanup = () => container.remove();
    expect(container.querySelector('.prm-empty h3')?.textContent).toBe('No pull requests monitored');
  });

  it('shows the filtered-empty state when a search hides every monitored PR', () => {
    const { container } = render(<PrTileList {...baseProps([makePr()])} />);
    cleanup = () => container.remove();
    const search = container.querySelector<HTMLInputElement>('.prm-search-input')!;
    fireEvent.change(search, { target: { value: 'zzz-no-match' } });
    const filtered = container.querySelector('.prm-empty--filtered');
    expect(filtered).toBeTruthy();
    expect(filtered?.querySelector('h3')?.textContent).toBe('No PRs match the current filter');
    // Clear-search escape hatch is offered.
    expect(within(filtered as HTMLElement).getByText('Clear search')).toBeTruthy();
  });

  // --- Segment tabs (AC-LIST-5.1/5.2/5.3) ---

  it('renders an "All" tab plus one tab per rollup status, All-count = total', () => {
    const prs = [makePr({ number: 1, status: 'green' }), makePr({ number: 2, status: 'failed' })];
    const { container } = render(<PrTileList {...baseProps(prs)} />);
    cleanup = () => container.remove();
    const tabs = container.querySelectorAll('.prm-segment-tab');
    // All + 9 status tabs.
    expect(tabs.length).toBe(10);
    const all = tabs[0];
    expect(all.textContent).toContain('All');
    expect(all.querySelector('.prm-segment-count')?.textContent).toBe('2');
  });

  it('renders status tabs under the List/Board controls row', () => {
    const { container } = render(<PrTileList {...baseProps([makePr()])} />);
    cleanup = () => container.remove();
    const toolbarKids = Array.from(container.querySelector('.prm-list-toolbar')?.children ?? []);
    const controlsIdx = toolbarKids.findIndex((el) => el.classList.contains('prm-list-controls'));
    const tabsIdx = toolbarKids.findIndex((el) => el.classList.contains('prm-segment-tabs'));
    expect(controlsIdx).toBeGreaterThanOrEqual(0);
    expect(tabsIdx).toBeGreaterThan(controlsIdx);
  });

  it('filters the list to the selected status tab', () => {
    const prs = [
      makePr({ number: 1, status: 'green', title: 'green-pr' }),
      makePr({ number: 2, status: 'failed', title: 'failed-pr' }),
    ];
    const { container } = render(<PrTileList {...baseProps(prs)} />);
    cleanup = () => container.remove();
    const failingTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-segment-tab')).find((t) =>
      t.textContent?.includes('Failing')
    )!;
    fireEvent.click(failingTab);
    const titles = Array.from(container.querySelectorAll('.prm-tile-title')).map((t) => t.textContent);
    expect(titles.join(' ')).toContain('failed-pr');
    expect(titles.join(' ')).not.toContain('green-pr');
    expect(failingTab.getAttribute('aria-selected')).toBe('true');
  });

  // --- Shown count + unread count (AC-LIST-7.1/7.2) ---

  it('reports the shown count and the unread count', () => {
    const prs = [
      makePr({ number: 1, lastStatusChange: NOW, lastSeenAt: NOW - 1000 }), // unread
      makePr({ number: 2, lastSeenAt: NOW }), // read
    ];
    const { container } = render(<PrTileList {...baseProps(prs)} />);
    cleanup = () => container.remove();
    expect(container.querySelector('.prm-shown-count')?.textContent).toBe('2 shown');
    expect(container.querySelector('.prm-unread-count')?.textContent).toContain('1');
  });

  // --- Host filter (R-LIST-027) ---

  describe('host filter', () => {
    it('lists every host present among the monitored PRs', () => {
      const prs = [
        makePr({ number: 1, url: 'https://github.com/owner/repo/pull/1', title: 'github-pr' }),
        makePr({ number: 2, url: 'https://git.soma.salesforce.com/owner/repo/pull/2', title: 'ghe-pr' }),
      ];
      const { container } = render(<PrTileList {...baseProps(prs)} />);
      cleanup = () => container.remove();

      const hostBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).find((b) =>
        b.textContent?.includes('Host')
      )!;
      fireEvent.click(hostBtn);

      const items = Array.from(document.querySelectorAll<HTMLButtonElement>('.prm-host-filter .prm-project-menu-item'));
      expect(items.map((i) => i.textContent)).toEqual(['All hosts', 'github.com', 'git.soma']);
    });

    it('narrows the list to the hosts passed via the hostScope prop', () => {
      const prs = [
        makePr({ number: 1, url: 'https://github.com/owner/repo/pull/1', title: 'github-pr' }),
        makePr({ number: 2, url: 'https://git.soma.salesforce.com/owner/repo/pull/2', title: 'ghe-pr' }),
      ];
      const { container } = render(<PrTileList {...baseProps(prs, { hostScope: ['git.soma.salesforce.com'] })} />);
      cleanup = () => container.remove();

      const titles = Array.from(container.querySelectorAll('.prm-tile-title')).map((t) => t.textContent);
      expect(titles.join(' ')).toContain('ghe-pr');
      expect(titles.join(' ')).not.toContain('github-pr');
    });

    it('emits onHostScopeChange when toggling a host, without closing the menu', () => {
      const prs = [
        makePr({ number: 1, url: 'https://github.com/owner/repo/pull/1' }),
        makePr({ number: 2, url: 'https://git.soma.salesforce.com/owner/repo/pull/2' }),
      ];
      const calls: string[][] = [];
      const { container } = render(
        <PrTileList {...baseProps(prs, { onHostScopeChange: (hosts) => calls.push(hosts) })} />
      );
      cleanup = () => container.remove();

      const hostBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-btn')).find((b) =>
        b.textContent?.includes('Host')
      )!;
      fireEvent.click(hostBtn);
      const githubItem = Array.from(
        document.querySelectorAll<HTMLButtonElement>('.prm-host-filter .prm-project-menu-item')
      ).find((i) => i.textContent === 'github.com')!;
      fireEvent.click(githubItem);
      expect(calls).toEqual([['github.com']]);

      const allHosts = Array.from(
        document.querySelectorAll<HTMLButtonElement>('.prm-host-filter .prm-project-menu-item')
      ).find((i) => i.textContent === 'All hosts')!;
      fireEvent.click(allHosts);
      expect(calls).toEqual([['github.com'], []]);
    });

    it('reflects the host-scoped set in tab counts and the shown count', () => {
      const prs = [
        makePr({ number: 1, url: 'https://github.com/owner/repo/pull/1' }),
        makePr({ number: 2, url: 'https://git.soma.salesforce.com/owner/repo/pull/2' }),
      ];
      const { container } = render(<PrTileList {...baseProps(prs, { hostScope: ['github.com'] })} />);
      cleanup = () => container.remove();

      const allTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-segment-tab')).find((t) =>
        t.textContent?.includes('All')
      )!;
      expect(allTab.querySelector('.prm-segment-count')?.textContent).toBe('1');
      expect(container.querySelector('.prm-shown-count')?.textContent).toBe('1 shown');
    });
  });

  // --- Quick search (AC-LIST-8.2) ---

  it('searches over title, PR number, status label, branches, work-item, and repo — but not author', () => {
    const prs = [
      makePr({ number: 101, title: 'Fix login', headRefName: 'feature/login', repo: 'acme/webapp' }),
      makePr({ number: 202, title: 'Update docs', headRefName: 'chore/docs', repo: 'acme/site' }),
    ];
    const { container } = render(<PrTileList {...baseProps(prs)} />);
    cleanup = () => container.remove();
    const search = container.querySelector<HTMLInputElement>('.prm-search-input')!;

    const shownTitles = () => Array.from(container.querySelectorAll('.prm-tile-title')).map((t) => t.textContent ?? '');

    fireEvent.change(search, { target: { value: 'webapp' } }); // repo short name
    expect(shownTitles().join(' ')).toContain('Fix login');
    expect(shownTitles().join(' ')).not.toContain('Update docs');

    fireEvent.change(search, { target: { value: '202' } }); // PR number
    expect(shownTitles().join(' ')).toContain('Update docs');

    fireEvent.change(search, { target: { value: 'chore/docs' } }); // source branch
    expect(shownTitles().join(' ')).toContain('Update docs');

    // Author is NOT part of the corpus — searching the author login hides all.
    fireEvent.change(search, { target: { value: 'octocat' } });
    expect(container.querySelector('.prm-empty--filtered')).toBeTruthy();
  });

  // --- Sort (AC-LIST-9.1…9.4) ---

  it('offers exactly the canonical sort fields', () => {
    const { container } = render(<PrTileList {...baseProps([makePr()])} />);
    cleanup = () => container.remove();
    const opts = Array.from(container.querySelectorAll('.prm-sort-select option')).map((o) => o.textContent);
    expect(opts).toEqual(['PR Updated', 'PR Created', 'Status', 'Status Updated', 'Favorites first']);
  });

  it('emits onSortChange when the field changes and when the direction toggles', () => {
    const calls: Array<[SortField, SortDir]> = [];
    const { container } = render(
      <PrTileList {...baseProps([makePr()], { onSortChange: (f, d) => calls.push([f, d]) })} />
    );
    cleanup = () => container.remove();
    fireEvent.change(container.querySelector('.prm-sort-select')!, { target: { value: 'created' } });
    fireEvent.click(container.querySelector('.prm-sort-dir')!);
    expect(calls).toContainEqual(['created', 'desc']);
    expect(calls).toContainEqual(['updated', 'asc']); // dir toggled from desc→asc
  });

  it('orders by Status using canonical triage severity (conflict before green) when sorting ascending', () => {
    const prs = [
      makePr({ number: 1, status: 'green', title: 'green-pr' }),
      makePr({ number: 2, status: 'conflict', title: 'conflict-pr' }),
    ];
    const { container } = render(
      <PrTileList {...baseProps(prs, { sortField: 'status', sortDir: 'asc' })} />
    );
    cleanup = () => container.remove();
    const titles = Array.from(container.querySelectorAll('.prm-tile-title')).map((t) => t.textContent);
    // rank 1 (conflict) first, rank 7 (green) after.
    expect(titles[0]).toContain('conflict-pr');
    expect(titles[1]).toContain('green-pr');
  });

  it('orders by "PR Updated" on GitHub updatedAt, not our poll time (lastChecked)', () => {
    // AC-LIST-9.1: the sort must reflect when the PR changed on GitHub. Give the
    // OLDER-updated PR the NEWER lastChecked to prove updatedAt wins.
    const prs = [
      makePr({ number: 1, title: 'older-update', updatedAt: NOW - 100_000, lastChecked: NOW }),
      makePr({ number: 2, title: 'newer-update', updatedAt: NOW, lastChecked: NOW - 100_000 }),
    ];
    const { container } = render(
      <PrTileList {...baseProps(prs, { sortField: 'updated', sortDir: 'desc' })} />
    );
    cleanup = () => container.remove();
    const titles = Array.from(container.querySelectorAll('.prm-tile-title')).map((t) => t.textContent);
    // desc → newest updatedAt first.
    expect(titles[0]).toContain('newer-update');
    expect(titles[1]).toContain('older-update');
  });

  it('treats updatedAt=0 (transient fetch failure) as missing and falls back to lastChecked', () => {
    // Regression: refreshOne persists updatedAt=0 when gh returns an unparseable
    // updatedAt. `??` would keep 0 and sink the PR to the epoch extreme; `||`
    // falls through to lastChecked so the PR still sorts by a real timestamp.
    const prs = [
      makePr({ number: 1, title: 'zero-updated', updatedAt: 0, lastChecked: NOW }),
      makePr({ number: 2, title: 'has-updated', updatedAt: NOW - 100_000, lastChecked: NOW - 100_000 }),
    ];
    const { container } = render(
      <PrTileList {...baseProps(prs, { sortField: 'updated', sortDir: 'desc' })} />
    );
    cleanup = () => container.remove();
    const titles = Array.from(container.querySelectorAll('.prm-tile-title')).map((t) => t.textContent);
    // zero-updated falls back to lastChecked (NOW) → newest → first on desc.
    expect(titles[0]).toContain('zero-updated');
    expect(titles[1]).toContain('has-updated');
  });

  // --- Selection + bulk bar (AC-LIST-6.1…6.7) ---

  it('shows the bulk-action bar with exactly Mark read/unread + Favorite + Dismiss once a PR is selected', () => {
    // Unread, unfavorited PRs → the toggles offer "Mark read" + "Favorite".
    const prs = [
      makePr({ number: 1, lastStatusChange: NOW, lastSeenAt: NOW - 1000 }),
      makePr({ number: 2, lastStatusChange: NOW, lastSeenAt: NOW - 1000 }),
    ];
    const { container } = render(<PrTileList {...baseProps(prs)} />);
    cleanup = () => container.remove();
    expect(container.querySelector('.prm-bulk-bar')).toBeFalsy();

    const firstRowCheckbox = container.querySelector<HTMLInputElement>('.prm-tile-select')!;
    fireEvent.click(firstRowCheckbox);

    const bar = container.querySelector('.prm-bulk-bar')!;
    expect(bar).toBeTruthy();
    expect(bar.querySelector('.prm-bulk-count')?.textContent).toBe('1 selected');
    const actionLabels = Array.from(bar.querySelectorAll('.prm-bulk-actions .prm-btn')).map((b) => b.textContent);
    expect(actionLabels).toEqual(['Mark read', 'Favorite', 'Dismiss']);
  });

  it('bulk Favorite calls onBulkSetFavorite(selected, true) for a non-favorited selection', () => {
    const prs = [makePr({ number: 1 }), makePr({ number: 2 })];
    const calls: Array<{ urls: string[]; favorite: boolean }> = [];
    const { container } = render(
      <PrTileList {...baseProps(prs, { onBulkSetFavorite: (urls, favorite) => calls.push({ urls, favorite }) })} />
    );
    cleanup = () => container.remove();

    fireEvent.click(container.querySelector<HTMLInputElement>('.prm-tile-select')!);
    const bar = container.querySelector('.prm-bulk-bar')!;
    const favBtn = Array.from(bar.querySelectorAll<HTMLButtonElement>('.prm-bulk-actions .prm-btn')).find(
      (b) => b.textContent === 'Favorite'
    )!;
    fireEvent.click(favBtn);
    expect(calls).toHaveLength(1);
    expect(calls[0].favorite).toBe(true);
    expect(calls[0].urls).toHaveLength(1);
  });

  it('bulk bar offers Unfavorite when every selected PR is already a favorite', () => {
    const prs = [makePr({ number: 1, favorite: true }), makePr({ number: 2, favorite: true })];
    const calls: Array<{ urls: string[]; favorite: boolean }> = [];
    const { container } = render(
      <PrTileList {...baseProps(prs, { onBulkSetFavorite: (urls, favorite) => calls.push({ urls, favorite }) })} />
    );
    cleanup = () => container.remove();

    fireEvent.click(container.querySelector<HTMLInputElement>('.prm-select-all input')!);
    const bar = container.querySelector('.prm-bulk-bar')!;
    const labels = Array.from(bar.querySelectorAll('.prm-bulk-actions .prm-btn')).map((b) => b.textContent);
    expect(labels).toEqual(['Mark unread', 'Unfavorite', 'Dismiss']);

    const unfavBtn = Array.from(bar.querySelectorAll<HTMLButtonElement>('.prm-bulk-actions .prm-btn')).find(
      (b) => b.textContent === 'Unfavorite'
    )!;
    fireEvent.click(unfavBtn);
    expect(calls[0].favorite).toBe(false);
    expect(calls[0].urls).toHaveLength(2);
  });

  // --- Pure bulk-favorite resolver (R-LIST-026) ---

  describe('resolveBulkFavorite', () => {
    it('favorites a mixed selection (some already favorite)', () => {
      const prs = [makePr({ number: 1, favorite: true }), makePr({ number: 2, favorite: false })];
      expect(resolveBulkFavorite([prs[0].url, prs[1].url], prs)).toEqual({ favorite: true, label: 'Favorite' });
    });

    it('favorites an all-unfavorited selection', () => {
      const prs = [makePr({ number: 1 }), makePr({ number: 2 })];
      expect(resolveBulkFavorite([prs[0].url, prs[1].url], prs)).toEqual({ favorite: true, label: 'Favorite' });
    });

    it('unfavorites only when EVERY selected PR is already a favorite', () => {
      const prs = [makePr({ number: 1, favorite: true }), makePr({ number: 2, favorite: true })];
      expect(resolveBulkFavorite([prs[0].url, prs[1].url], prs)).toEqual({ favorite: false, label: 'Unfavorite' });
    });

    it('favorites an empty selection (no-op target)', () => {
      expect(resolveBulkFavorite([], [])).toEqual({ favorite: true, label: 'Favorite' });
    });
  });

  // --- Favorites-first comparator + grouping mode (R-LIST-026 / AC-LIST-9.1) ---

  describe('compareFavoritesFirst', () => {
    it('orders favorites before non-favorites', () => {
      const fav = makePr({ number: 1, favorite: true, lastStatusChange: NOW - 100_000 });
      const plain = makePr({ number: 2, favorite: false, lastStatusChange: NOW });
      // Favorite wins even though its status changed longer ago.
      expect(compareFavoritesFirst(fav, plain)).toBeLessThan(0);
      expect(compareFavoritesFirst(plain, fav)).toBeGreaterThan(0);
    });

    it('within a group orders newest status-change first', () => {
      const newer = makePr({ number: 1, favorite: true, lastStatusChange: NOW });
      const older = makePr({ number: 2, favorite: true, lastStatusChange: NOW - 100_000 });
      expect(compareFavoritesFirst(newer, older)).toBeLessThan(0);
      expect(compareFavoritesFirst(older, newer)).toBeGreaterThan(0);
    });
  });

  it('favorites-first sort groups favorites at the top regardless of direction', () => {
    const prs = [
      makePr({ number: 1, favorite: false, title: 'plain-pr' }),
      makePr({ number: 2, favorite: true, title: 'fav-pr' }),
    ];
    // Descending direction must NOT invert the grouping (fixed order).
    const { container } = render(
      <PrTileList {...baseProps(prs, { sortField: 'favorites', sortDir: 'desc' })} />
    );
    cleanup = () => container.remove();
    const titles = Array.from(container.querySelectorAll('.prm-tile-title')).map((t) => t.textContent);
    expect(titles[0]).toContain('fav-pr');
    expect(titles[1]).toContain('plain-pr');
  });

  it('disables the direction toggle in favorites-first mode', () => {
    const { container } = render(
      <PrTileList {...baseProps([makePr()], { sortField: 'favorites' })} />
    );
    cleanup = () => container.remove();
    const dir = container.querySelector<HTMLButtonElement>('.prm-sort-dir')!;
    expect(dir.disabled).toBe(true);
  });

  it('select-all checkbox selects every shown PR and clears on second toggle', () => {
    const prs = [makePr({ number: 1 }), makePr({ number: 2 }), makePr({ number: 3 })];
    const { container } = render(<PrTileList {...baseProps(prs)} />);
    cleanup = () => container.remove();
    const selectAll = container.querySelector<HTMLInputElement>('.prm-select-all input')!;
    fireEvent.click(selectAll);
    expect(container.querySelector('.prm-bulk-count')?.textContent).toBe('3 selected');
    fireEvent.click(selectAll);
    expect(container.querySelector('.prm-bulk-bar')).toBeFalsy();
  });

  it('bulk Dismiss calls onBulkDismiss with exactly the selected URLs', () => {
    const prs = [makePr({ number: 1 }), makePr({ number: 2 })];
    const dismissed: string[][] = [];
    const { container } = render(
      <PrTileList {...baseProps(prs, { onBulkDismiss: (urls) => dismissed.push(urls) })} />
    );
    cleanup = () => container.remove();
    fireEvent.click(container.querySelector<HTMLInputElement>('.prm-tile-select')!);
    const dismissBtn = Array.from(container.querySelectorAll('.prm-bulk-actions .prm-btn')).find(
      (b) => b.textContent === 'Dismiss'
    )!;
    fireEvent.click(dismissBtn);
    expect(dismissed).toEqual([[prs[0].url]]);
  });

  // --- Mark-read toolbar action (AC-LIST-10.2/10.3) ---

  it('toolbar Mark read targets all shown PRs when nothing is selected', () => {
    const prs = [
      makePr({ number: 1, lastStatusChange: NOW, lastSeenAt: NOW - 1000 }), // unread
      makePr({ number: 2, lastSeenAt: NOW }),
    ];
    const seenCalls: Array<[string[], boolean]> = [];
    const { container } = render(
      <PrTileList {...baseProps(prs, { onBulkSetSeen: (urls, seen) => seenCalls.push([urls, seen]) })} />
    );
    cleanup = () => container.remove();
    const markBtn = Array.from(container.querySelectorAll('.prm-list-controls .prm-btn')).find((b) =>
      b.textContent?.includes('Mark read')
    )!;
    fireEvent.click(markBtn);
    expect(seenCalls[0][0]).toEqual([prs[0].url, prs[1].url]);
    // Targets are not all-read (one unread) → button says "Mark read" → seen=true.
    expect(seenCalls[0][1]).toBe(true);
  });

  it('toolbar Mark unread passes seen=false when every target is already read', () => {
    // Regression (HIGH-1): the seen flag must be the inverse of targetsAllRead.
    // When all shown PRs are read the button reads "Mark unread" and must
    // dispatch seen=false, else the control is a no-op that re-marks read.
    const prs = [
      makePr({ number: 1, lastSeenAt: NOW }), // read
      makePr({ number: 2, lastSeenAt: NOW }), // read
    ];
    const seenCalls: Array<[string[], boolean]> = [];
    const { container } = render(
      <PrTileList {...baseProps(prs, { onBulkSetSeen: (urls, seen) => seenCalls.push([urls, seen]) })} />
    );
    cleanup = () => container.remove();
    const markBtn = Array.from(container.querySelectorAll('.prm-list-controls .prm-btn')).find((b) =>
      b.textContent?.includes('Mark unread')
    )!;
    expect(markBtn, 'all-read → button offers "Mark unread"').toBeTruthy();
    fireEvent.click(markBtn);
    expect(seenCalls[0][1]).toBe(false);
  });

  it('bulk Mark read targets every PR selected through select-all', () => {
    const prs = [
      makePr({ number: 1, lastStatusChange: NOW, lastSeenAt: NOW - 1000 }),
      makePr({ number: 2, lastStatusChange: NOW, lastSeenAt: NOW - 1000 }),
      makePr({ number: 3, lastStatusChange: NOW, lastSeenAt: NOW - 1000 }),
    ];
    const seenCalls: Array<[string[], boolean]> = [];
    const { container } = render(
      <PrTileList {...baseProps(prs, { onBulkSetSeen: (urls, seen) => seenCalls.push([urls, seen]) })} />
    );
    cleanup = () => container.remove();

    fireEvent.click(container.querySelector<HTMLInputElement>('.prm-select-all input')!);
    const markBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-bulk-actions .prm-btn')).find(
      (b) => b.textContent === 'Mark read'
    )!;
    fireEvent.click(markBtn);

    expect(seenCalls).toEqual([[prs.map((pr) => pr.url), true]]);
  });

  it('bulk Mark unread targets every PR selected through select-all', () => {
    const prs = [
      makePr({ number: 1, lastSeenAt: NOW }),
      makePr({ number: 2, lastSeenAt: NOW }),
      makePr({ number: 3, lastSeenAt: NOW }),
    ];
    const seenCalls: Array<[string[], boolean]> = [];
    const { container } = render(
      <PrTileList {...baseProps(prs, { onBulkSetSeen: (urls, seen) => seenCalls.push([urls, seen]) })} />
    );
    cleanup = () => container.remove();

    fireEvent.click(container.querySelector<HTMLInputElement>('.prm-select-all input')!);
    const markBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-bulk-actions .prm-btn')).find(
      (b) => b.textContent === 'Mark unread'
    )!;
    fireEvent.click(markBtn);

    expect(seenCalls).toEqual([[prs.map((pr) => pr.url), false]]);
  });

  it('offers Mark read after select-all marks unchanged PRs unread', () => {
    const prs = [
      makePr({ number: 1, addedAt: NOW, lastStatusChange: NOW, lastSeenAt: 0 }),
      makePr({ number: 2, addedAt: NOW, lastStatusChange: NOW, lastSeenAt: 0 }),
      makePr({ number: 3, addedAt: NOW, lastStatusChange: NOW, lastSeenAt: 0 }),
    ];
    const { container } = render(<PrTileList {...baseProps(prs)} />);
    cleanup = () => container.remove();

    fireEvent.click(container.querySelector<HTMLInputElement>('.prm-select-all input')!);
    expect(container.querySelector('.prm-bulk-actions .prm-btn')?.textContent).toBe('Mark read');
  });

  // --- Status-colored segment tabs + bulk icons ---

  it('status tabs carry status-color modifier classes (prm-segment-tab--<status>)', () => {
    const prs = [makePr({ status: 'conflict' }), makePr({ status: 'green' })];
    const { container } = render(<PrTileList {...baseProps(prs)} />);
    cleanup = () => container.remove();
    const tabs = container.querySelectorAll('.prm-segment-tab');
    const conflict = Array.from(tabs).find((t) => t.textContent?.includes('Merge conflict'));
    const green = Array.from(tabs).find((t) => t.textContent?.includes('All checks passing'));
    expect(conflict?.classList.contains('prm-segment-tab--conflict')).toBe(true);
    expect(green?.classList.contains('prm-segment-tab--green')).toBe(true);
  });

  it('bulk-bar mark-read/unread and dismiss buttons render icons', () => {
    const prs = [
      makePr({ number: 1, lastStatusChange: NOW, lastSeenAt: NOW - 1000 }),
      makePr({ number: 2, lastSeenAt: NOW }),
    ];
    const { container } = render(<PrTileList {...baseProps(prs)} />);
    cleanup = () => container.remove();
    const firstCheckbox = container.querySelector<HTMLInputElement>('.prm-tile-select')!;
    fireEvent.click(firstCheckbox);
    const bar = container.querySelector('.prm-bulk-bar')!;
    const actions = bar.querySelectorAll('.prm-bulk-actions .prm-btn');
    // Check for svg (lucide icons render as <svg>).
    expect(actions[0].querySelector('svg'), 'mark-read button has icon').toBeTruthy();
    expect(actions[1].querySelector('svg'), 'dismiss button has icon').toBeTruthy();
  });

  it('Board toggle hides status tabs and renders kanban columns', () => {
    const prs = [
      makePr({ number: 1, status: 'green', title: 'ready-pr' }),
      makePr({ number: 2, status: 'failed', title: 'fail-pr' }),
    ];
    const { container } = render(<PrTileList {...baseProps(prs, { viewMode: 'board' })} />);
    cleanup = () => container.remove();
    expect(container.querySelector('.prm-segment-tabs')).toBeNull();
    expect(container.querySelector('.prm-board')).toBeTruthy();
    expect(container.querySelector('.prm-tile-list')).toBeNull();
    expect(container.querySelector('[data-board-column="green"] .prm-board-card-title')?.textContent).toContain('ready-pr');
    expect(container.querySelector('[data-board-column="failed"] .prm-board-card-title')?.textContent).toContain('fail-pr');
    expect(container.querySelector('.prm-view-toggle-btn[aria-pressed="true"]')?.textContent).toContain('Board');
  });

  it('List toggle restores the tile list and status tabs', () => {
    const modes: string[] = [];
    const { container } = render(
      <PrTileList {...baseProps([makePr()], { viewMode: 'board', onViewModeChange: (m) => modes.push(m) })} />
    );
    cleanup = () => container.remove();
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[title="List view"]')!);
    expect(modes).toEqual(['list']);
  });

  it('uncontrolled Board click switches the surface locally', () => {
    const { container } = render(<PrTileList {...baseProps([makePr()])} />);
    cleanup = () => container.remove();
    expect(container.querySelector('.prm-tile-list')).toBeTruthy();
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[title="Board view"]')!);
    expect(container.querySelector('.prm-board')).toBeTruthy();
    expect(container.querySelector('.prm-segment-tabs')).toBeNull();
  });

  it('switching to Board from a status tab shows every column, not the filtered set', () => {
    const prs = [
      makePr({ number: 1, status: 'green', title: 'ready-pr' }),
      makePr({ number: 2, status: 'failed', title: 'fail-pr' }),
    ];
    const { container } = render(<PrTileList {...baseProps(prs)} />);
    cleanup = () => container.remove();
    const failingTab = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-segment-tab')).find((t) =>
      t.textContent?.includes('Failing')
    )!;
    fireEvent.click(failingTab);
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[title="Board view"]')!);
    expect(container.querySelector('[data-board-column="failed"] .prm-board-card-title')?.textContent).toContain(
      'fail-pr'
    );
    expect(container.querySelector('[data-board-column="green"] .prm-board-card-title')?.textContent).toContain(
      'ready-pr'
    );
  });

  it('board toolbar hides list chrome and offers Select plus Empty lanes', () => {
    const prs = [
      makePr({ number: 1, status: 'green', title: 'ready-pr' }),
      makePr({ number: 2, status: 'failed', title: 'fail-pr' }),
    ];
    const { container } = render(<PrTileList {...baseProps(prs, { viewMode: 'board' })} />);
    cleanup = () => container.remove();
    expect(container.querySelector('.prm-select-all')).toBeNull();
    expect(container.querySelector('.prm-shown-count')).toBeNull();
    expect(container.querySelector('.prm-sort')).toBeNull();
    expect(
      Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.includes('Mark read'))
    ).toBe(false);
    expect(container.querySelector('button[title="Select cards for bulk actions"]')).toBeTruthy();
    expect(
      Array.from(container.querySelectorAll('button')).some((b) => b.textContent?.includes('Empty (5)'))
    ).toBe(true);
  });

  it('Empty toggle reveals hidden columns and collapse hides a lane body', () => {
    const { container } = render(
      <PrTileList {...baseProps([makePr({ status: 'green' })], { viewMode: 'board' })} />
    );
    cleanup = () => container.remove();
    expect(container.querySelector('[data-board-column="failed"]')).toBeNull();
    fireEvent.click(
      Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
        b.textContent?.includes('Empty')
      )!
    );
    expect(container.querySelector('[data-board-column="failed"]')).toBeTruthy();
    fireEvent.click(
      container.querySelector<HTMLButtonElement>('[data-board-column="green"] .prm-board-col-collapse')!
    );
    expect(container.querySelector('[data-board-column="green"]')?.getAttribute('data-collapsed')).toBe('true');
    expect(container.querySelector('[data-board-column="green"] .prm-board-card')).toBeNull();
  });

  it('Select mode lets a card click start a bulk selection', () => {
    const { container } = render(
      <PrTileList {...baseProps([makePr({ lastSeenAt: 0 })], { viewMode: 'board' })} />
    );
    cleanup = () => container.remove();
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[title="Select cards for bulk actions"]')!);
    expect(container.querySelector('.prm-board-card--select-mode')).toBeTruthy();
    fireEvent.click(container.querySelector('.prm-board-card')!);
    expect(container.querySelector('.prm-bulk-bar')).toBeTruthy();
    expect(container.querySelector('.prm-bulk-count')?.textContent).toBe('1 selected');
    expect(document.querySelector('.prm-modal--detail')).toBeNull();
  });

  it('clicking a board card opens a detail modal', () => {
    const dismissed: string[] = [];
    const { unmount } = render(
      <PrTileList
        {...baseProps(
          [
            makePr({
              number: 7,
              title: 'Ready to inspect',
              body: 'More detail than the card shows.',
              lastSeenAt: NOW,
            }),
          ],
          {
            viewMode: 'board',
            onDismiss: (u) => dismissed.push(u),
            repositories: [
              {
                owner: 'owner',
                repo: 'repo',
                host: 'github.com',
                orgLogin: 'owner',
                active: true,
                createdAt: 1,
                notifyInApp: true,
                ignoredFailingChecks: ['Snyk'],
                sfciGated: true,
              },
            ],
          }
        )}
      />
    );
    cleanup = () => unmount();
    expect(document.querySelector('.prm-modal--detail')).toBeNull();
    fireEvent.click(document.querySelector('.prm-board-card')!);
    const modal = document.querySelector('.prm-modal--detail');
    expect(modal).toBeTruthy();
    expect(modal?.textContent).toContain('Ready to inspect');
    expect(modal?.textContent).toContain('More detail than the card shows.');
    fireEvent.click(modal!.querySelector<HTMLButtonElement>('button[title="Close"]')!);
    expect(document.querySelector('.prm-modal--detail')).toBeNull();
    fireEvent.click(document.querySelector('.prm-board-card')!);
    fireEvent.click(document.querySelector<HTMLButtonElement>('.prm-modal--detail button[aria-label="Dismiss"]')!);
    expect(dismissed).toEqual(['https://github.com/owner/repo/pull/7']);
    expect(document.querySelector('.prm-modal--detail')).toBeNull();
  });

  it('closes the detail modal when the open PR leaves the list', () => {
    function Harness() {
      const [items, setItems] = useState([makePr({ number: 7, title: 'Soon gone', lastSeenAt: NOW })]);
      return (
        <div>
          <button type="button" data-testid="drop-pr" onClick={() => setItems([])}>
            drop
          </button>
          <PrTileList {...baseProps(items, { viewMode: 'board' })} />
        </div>
      );
    }
    const { unmount } = render(<Harness />);
    cleanup = () => unmount();
    fireEvent.click(document.querySelector('.prm-board-card')!);
    expect(document.querySelector('.prm-modal--detail')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-testid="drop-pr"]')!);
    expect(document.querySelector('.prm-modal--detail')).toBeNull();
  });

  it('restores persisted empty-lane and collapsed preferences', async () => {
    const host = makeHost();
    (host.storage as { get: (key: string) => Promise<unknown> }).get = async (key) => {
      if (key === 'boardShowEmpty') return true;
      if (key === 'boardCollapsed') return ['green', 'not-a-status'];
      return null;
    };
    const { container } = render(
      <PrTileList {...baseProps([makePr({ status: 'green' })], { viewMode: 'board', host })} />
    );
    cleanup = () => container.remove();
    await waitFor(() => {
      expect(container.querySelector('[data-board-column="failed"]')).toBeTruthy();
      expect(container.querySelector('[data-board-column="green"]')?.getAttribute('data-collapsed')).toBe('true');
    });
    fireEvent.click(
      Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
        b.textContent?.includes('Hide empty')
      )!
    );
    expect(container.querySelector('[data-board-column="failed"]')).toBeNull();
  });
});
