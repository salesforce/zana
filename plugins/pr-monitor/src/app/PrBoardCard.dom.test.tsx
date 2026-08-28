/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import type { ModuleHost } from './host.js';
import { PrBoardCard } from './PrBoardCard.js';
import type { MonitoredPr } from '../../lib/types.js';

describe('PrBoardCard', () => {
  let cleanup: (() => void) | null = null;
  afterEach(() => {
    cleanup?.();
    cleanup = null;
  });

  function makeHost(over?: Partial<ModuleHost>) {
    const calls: Array<{ handler: string; args: unknown[] }> = [];
    const host = {
      call: async (handler: string, ...args: unknown[]) => {
        calls.push({ handler, args });
        return { ok: true, prs: [] };
      },
      cache: { get: () => null, set: () => {}, refreshBadge: () => {} },
      openExternal: () => {},
      toast: () => {},
      storage: { get: async () => null, set: async () => {} },
      listProjects: () => [],
      ...over,
    } as unknown as ModuleHost;
    return { host, calls };
  }

  function makePr(partial?: Partial<MonitoredPr>): MonitoredPr {
    return {
      url: 'https://github.com/acme/webapp/pull/42',
      repo: 'acme/webapp',
      number: 42,
      title: '@W-1234567: Fix the thing',
      baseRefName: 'main',
      headRefName: 'fix/the-thing',
      status: 'green',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checks: [],
      addedAt: Date.now() - 1000,
      lastChecked: Date.now(),
      lastStatusChange: Date.now() - 500,
      createdAt: Date.now() - 3600000,
      author: { login: 'octocat', name: 'Octo Cat' },
      isDraft: false,
      workItem: 'W-1234567',
      source: 'manual',
      lastSeenAt: Date.now(),
      ...partial,
    };
  }

  function mount(pr: MonitoredPr, over?: {
    selected?: boolean;
    selectMode?: boolean;
    onToggleSelect?: (u: string) => void;
    onDismiss?: (u: string) => void;
    onOpen?: (u: string) => void;
    host?: ModuleHost;
  }) {
    const { host, calls } = over?.host ? { host: over.host, calls: [] } : makeHost();
    const onDismiss = over?.onDismiss ?? (() => {});
    const onToggleSelect = over?.onToggleSelect ?? (() => {});
    const onOpen = over?.onOpen ?? (() => {});
    const { container } = render(
      <PrBoardCard
        pr={pr}
        host={host}
        selected={over?.selected ?? false}
        selectMode={over?.selectMode}
        onToggleSelect={onToggleSelect}
        onDismiss={onDismiss}
        onOpen={onOpen}
      />
    );
    cleanup = () => container.remove();
    return { container, host, calls, onDismiss, onToggleSelect, onOpen };
  }

  it('renders short repo, number, work item, and title', () => {
    const { container } = mount(makePr());
    expect(container.querySelector('.prm-board-card-num')?.textContent).toBe('#42');
    expect(container.querySelector('.prm-board-card-repo')?.textContent).toBe('webapp');
    expect(container.querySelector('.prm-board-card-wi')?.textContent).toContain('W-1234567');
    expect(container.querySelector('.prm-board-card-title')?.textContent).toContain('Fix the thing');
    expect(container.querySelector('.prm-avatar')?.textContent).toBe('OC');
  });

  it('marks unread cards and seen cards distinctly', () => {
    const unread = mount(makePr({ lastSeenAt: 0 }));
    expect(unread.container.querySelector('.prm-board-card')?.classList.contains('prm-board-card--unread')).toBe(true);
    cleanup?.();
    const seen = mount(makePr({ lastSeenAt: Date.now(), lastStatusChange: Date.now() - 5000 }));
    expect(seen.container.querySelector('.prm-board-card')?.classList.contains('prm-board-card--unread')).toBe(false);
  });

  it('shows a Draft chip on draft PRs', () => {
    const { container } = mount(makePr({ isDraft: true }));
    expect(container.querySelector('.prm-board-card-draft')?.textContent).toContain('Draft');
  });

  it('records markPrAsSeen when an unread card is clicked', async () => {
    const calls: Array<{ handler: string; args: unknown[] }> = [];
    const opened: string[] = [];
    const { host } = makeHost();
    (host as { call: ModuleHost['call'] }).call = async (handler, ...args) => {
      calls.push({ handler, args });
      return { ok: true, prs: [] };
    };
    const { container } = mount(makePr({ lastSeenAt: 0 }), { host, onOpen: (u) => opened.push(u) });
    fireEvent.click(container.querySelector('.prm-board-card')!);
    await Promise.resolve();
    expect(calls.some((c) => c.handler === 'markPrAsSeen')).toBe(true);
    expect(opened).toEqual(['https://github.com/acme/webapp/pull/42']);
  });

  it('marks seen from Enter or Space on an unread card', async () => {
    const calls: Array<{ handler: string }> = [];
    const opened: string[] = [];
    const { host } = makeHost();
    (host as { call: ModuleHost['call'] }).call = async (handler) => {
      calls.push({ handler });
      return { ok: true, prs: [] };
    };
    const { container } = mount(makePr({ lastSeenAt: 0 }), { host, onOpen: (u) => opened.push(u) });
    const card = container.querySelector('.prm-board-card')!;
    fireEvent.keyDown(card, { key: 'Enter' });
    fireEvent.keyDown(card, { key: ' ' });
    await Promise.resolve();
    expect(calls.filter((c) => c.handler === 'markPrAsSeen').length).toBe(2);
    expect(opened).toHaveLength(2);
  });

  it('ignores other keys on the card', async () => {
    const calls: Array<{ handler: string }> = [];
    const { host } = makeHost();
    (host as { call: ModuleHost['call'] }).call = async (handler) => {
      calls.push({ handler });
      return { ok: true, prs: [] };
    };
    const { container } = mount(makePr({ lastSeenAt: 0 }), { host });
    fireEvent.keyDown(container.querySelector('.prm-board-card')!, { key: 'Escape' });
    await Promise.resolve();
    expect(calls).toEqual([]);
  });

  it('opens details on a seen card without marking it seen', async () => {
    const calls: Array<{ handler: string }> = [];
    const opened: string[] = [];
    const { host } = makeHost();
    (host as { call: ModuleHost['call'] }).call = async (handler) => {
      calls.push({ handler });
      return { ok: true, prs: [] };
    };
    const { container } = mount(makePr({ lastSeenAt: Date.now() }), {
      host,
      onOpen: (u) => opened.push(u),
    });
    fireEvent.click(container.querySelector('.prm-board-card')!);
    await Promise.resolve();
    expect(calls.some((c) => c.handler === 'markPrAsSeen')).toBe(false);
    expect(opened).toEqual(['https://github.com/acme/webapp/pull/42']);
  });

  it('opens a safe GitHub URL from the open button', () => {
    const opened: string[] = [];
    const { host } = makeHost();
    (host as { openExternal: (url: string) => void }).openExternal = (url) => opened.push(url);
    const { container } = mount(makePr(), { host });
    const openBtn = container.querySelector<HTMLButtonElement>('button[aria-label="Open on GitHub"]')!;
    fireEvent.click(openBtn);
    expect(opened).toEqual(['https://github.com/acme/webapp/pull/42']);
  });

  it('refuses a non-http URL', () => {
    const toasts: string[] = [];
    const { host } = makeHost();
    (host as { toast: (m: string) => void }).toast = (m) => toasts.push(m);
    const { container } = mount(makePr({ url: 'file:///etc/passwd' }), { host });
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[aria-label="Open on GitHub"]')!);
    expect(toasts[0]).toContain('Refusing');
  });

  it('refuses a malformed URL', () => {
    const toasts: string[] = [];
    const { host } = makeHost();
    (host as { toast: (m: string) => void }).toast = (m) => toasts.push(m);
    const { container } = mount(makePr({ url: 'not-a-url' }), { host });
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[aria-label="Open on GitHub"]')!);
    expect(toasts[0]).toContain('Refusing');
  });

  it('dismisses from the card action', () => {
    const dismissed: string[] = [];
    const { container } = mount(makePr(), { onDismiss: (u) => dismissed.push(u) });
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!);
    expect(dismissed).toEqual(['https://github.com/acme/webapp/pull/42']);
  });

  it('toggles favorite', async () => {
    const calls: Array<{ handler: string; args: unknown[] }> = [];
    const { host } = makeHost();
    (host as { call: ModuleHost['call'] }).call = async (handler, ...args) => {
      calls.push({ handler, args });
      return { ok: true, prs: [] };
    };
    const { container } = mount(makePr({ favorite: false }), { host });
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[aria-label="Favorite"]')!);
    await Promise.resolve();
    expect(calls[0]?.handler).toBe('setPrFavorite');
    expect((calls[0]?.args[0] as { favorite: boolean }).favorite).toBe(true);
  });

  it('unfavorites an already-starred card', async () => {
    const calls: Array<{ handler: string; args: unknown[] }> = [];
    const { host } = makeHost();
    (host as { call: ModuleHost['call'] }).call = async (handler, ...args) => {
      calls.push({ handler, args });
      return { ok: true, prs: [] };
    };
    const { container } = mount(makePr({ favorite: true }), { host });
    expect(container.querySelector('.prm-board-card--favorite')).toBeTruthy();
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[aria-label="Unfavorite"]')!);
    await Promise.resolve();
    expect((calls[0]?.args[0] as { favorite: boolean }).favorite).toBe(false);
  });

  it('applies selected and closed modifiers', () => {
    const closed = mount(makePr({ status: 'closed-merged' }), { selected: true });
    const card = closed.container.querySelector('.prm-board-card')!;
    expect(card.classList.contains('prm-board-card--selected')).toBe(true);
    expect(card.classList.contains('prm-board-card--closed')).toBe(true);
  });

  it('shows a stall cue when the build clock is past the danger threshold', () => {
    const { container } = mount(
      makePr({
        status: 'failed',
        lastStatusChange: Date.now() - 8 * 60 * 60 * 1000,
        checks: [{ name: 'ci', state: 'FAILURE' }],
      })
    );
    const cue = container.querySelector('.prm-tis--danger');
    expect(cue?.textContent).toMatch(/stalled/i);
  });

  it('shows Merge stalled when a ready-to-merge PR sits in yellow past the danger bar', () => {
    const { container } = mount(
      makePr({
        status: 'yellow',
        reviewDecision: 'APPROVED',
        buildHappy: true,
        lastStatusChange: Date.now() - 8 * 60 * 60 * 1000,
        checks: [{ name: 'ci', state: 'SUCCESS' }],
      })
    );
    expect(container.querySelector('.prm-tis--danger')?.textContent).toMatch(/Merge stalled/);
  });

  it('shows a warn cue in the slow band', () => {
    const { container } = mount(
      makePr({
        status: 'failed',
        lastStatusChange: Date.now() - 5 * 60 * 60 * 1000,
        checks: [{ name: 'ci', state: 'FAILURE' }],
      })
    );
    expect(container.querySelector('.prm-tis--warn')?.textContent).toMatch(/slow/i);
  });

  it('toggles selection from the checkbox without marking seen', async () => {
    const selected: string[] = [];
    const calls: Array<{ handler: string }> = [];
    const { host } = makeHost();
    (host as { call: ModuleHost['call'] }).call = async (handler) => {
      calls.push({ handler });
      return { ok: true, prs: [] };
    };
    const { container } = mount(makePr({ lastSeenAt: 0 }), {
      host,
      onToggleSelect: (u) => selected.push(u),
    });
    fireEvent.click(container.querySelector('.prm-board-card-select')!);
    await Promise.resolve();
    expect(selected).toEqual(['https://github.com/acme/webapp/pull/42']);
    expect(calls.some((c) => c.handler === 'markPrAsSeen')).toBe(false);
  });

  it('extracts a work item from the title when the field is missing', () => {
    const { container } = mount(
      makePr({ workItem: undefined, title: '@W-12345678: extracted title' })
    );
    expect(container.querySelector('.prm-board-card-wi')?.textContent).toContain('W-12345678');
    expect(container.querySelector('.prm-board-card-title')?.textContent).toContain('extracted title');
  });

  it('renders a title without a work-item prefix', () => {
    const { container } = mount(makePr({ workItem: undefined, title: 'Plain title', headRefName: 'feature/x', body: '' }));
    expect(container.querySelector('.prm-board-card-wi')).toBeNull();
    expect(container.querySelector('.prm-board-card-title')?.textContent).toBe('Plain title');
  });

  it('does not update the cache when mark-seen fails', async () => {
    const sets: unknown[] = [];
    const { host } = makeHost();
    (host as { call: ModuleHost['call'] }).call = async () => ({ ok: false });
    (host.cache as { set: (k: string, v: unknown) => void }).set = (k, v) => sets.push([k, v]);
    const { container } = mount(makePr({ lastSeenAt: 0 }), { host });
    fireEvent.click(container.querySelector('.prm-board-card')!);
    await Promise.resolve();
    expect(sets).toEqual([]);
  });

  it('renders failing and pending check pips, not passing ones', () => {
    const { container } = mount(
      makePr({
        checks: [
          { name: 'ci', state: 'SUCCESS' },
          { name: 'lint', state: 'FAILURE' },
          { name: 'e2e', state: 'PENDING' },
        ],
      })
    );
    expect(container.querySelector('.prm-check-pip--pass')).toBeNull();
    expect(container.querySelector('.prm-check-pip--fail')?.textContent).toContain('1');
    expect(container.querySelector('.prm-check-pip--pending')?.textContent).toContain('1');
  });

  it('⌘-click selects the card instead of opening details', async () => {
    const selected: string[] = [];
    const opened: string[] = [];
    const calls: Array<{ handler: string }> = [];
    const { host } = makeHost();
    (host as { call: ModuleHost['call'] }).call = async (handler) => {
      calls.push({ handler });
      return { ok: true, prs: [] };
    };
    const { container } = mount(makePr({ lastSeenAt: 0 }), {
      host,
      onToggleSelect: (u) => selected.push(u),
      onOpen: (u) => opened.push(u),
    });
    fireEvent.click(container.querySelector('.prm-board-card')!, { metaKey: true });
    fireEvent.click(container.querySelector('.prm-board-card')!, { ctrlKey: true });
    await Promise.resolve();
    expect(selected).toEqual([
      'https://github.com/acme/webapp/pull/42',
      'https://github.com/acme/webapp/pull/42',
    ]);
    expect(opened).toEqual([]);
    expect(calls.some((c) => c.handler === 'markPrAsSeen')).toBe(false);
  });

  it('select mode click toggles selection instead of opening details', async () => {
    const selected: string[] = [];
    const opened: string[] = [];
    const calls: Array<{ handler: string }> = [];
    const { host } = makeHost();
    (host as { call: ModuleHost['call'] }).call = async (handler) => {
      calls.push({ handler });
      return { ok: true, prs: [] };
    };
    const { container } = mount(makePr({ lastSeenAt: 0 }), {
      host,
      selectMode: true,
      onToggleSelect: (u) => selected.push(u),
      onOpen: (u) => opened.push(u),
    });
    expect(container.querySelector('.prm-board-card--select-mode')).toBeTruthy();
    fireEvent.click(container.querySelector('.prm-board-card')!);
    fireEvent.keyDown(container.querySelector('.prm-board-card')!, { key: 'Enter' });
    await Promise.resolve();
    expect(selected).toEqual([
      'https://github.com/acme/webapp/pull/42',
      'https://github.com/acme/webapp/pull/42',
    ]);
    expect(opened).toEqual([]);
    expect(calls.some((c) => c.handler === 'markPrAsSeen')).toBe(false);
  });

  it('shows a stale retry control when sync failed', async () => {
    const calls: Array<{ handler: string }> = [];
    const { host } = makeHost();
    (host as { call: ModuleHost['call'] }).call = async (handler) => {
      calls.push({ handler });
      return { ok: true, prs: [] };
    };
    const { container } = mount(makePr({ syncError: 'timeout' }), { host });
    expect(container.querySelector('.prm-board-card--stale')).toBeTruthy();
    fireEvent.click(container.querySelector<HTMLButtonElement>('button[aria-label="Retry syncing this PR"]')!);
    await Promise.resolve();
    expect(calls.some((c) => c.handler === 'retryPr')).toBe(true);
  });
});
