/**
 * @vitest-environment happy-dom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import type { ModuleHost, ProjectInfo } from './host.js';
import { PrDetailModal } from './PrDetailModal.js';
import type { MonitoredPr } from '../../lib/types.js';

const copyText = vi.hoisted(() => vi.fn(async () => true));
vi.mock('./clipboard.js', () => ({ copyText }));

const PROJECTS: ProjectInfo[] = [{ id: 'proj-a', name: 'Alpha', path: '/repos/alpha' }];

describe('PrDetailModal', () => {
  let unmountFn: (() => void) | null = null;
  afterEach(() => {
    unmountFn?.();
    unmountFn = null;
    document.querySelectorAll('.modal-backdrop').forEach((n) => n.remove());
    copyText.mockReset();
    copyText.mockResolvedValue(true);
  });

  function makeHost(over?: Partial<ModuleHost>) {
    const calls: Array<{ handler: string; args: unknown[] }> = [];
    const cacheSets: Array<[string, unknown]> = [];
    const opened: string[] = [];
    const toasts: Array<{ message: string; kind?: string }> = [];
    const host = {
      call: async (handler: string, ...args: unknown[]) => {
        calls.push({ handler, args });
        return { ok: true, prs: [{ url: 'https://github.com/acme/webapp/pull/42' }] };
      },
      cache: {
        get: () => null,
        set: (k: string, v: unknown) => cacheSets.push([k, v]),
        refreshBadge: () => {},
      },
      openExternal: (url: string) => opened.push(url),
      toast: (message: string, kind?: string) => toasts.push({ message, kind }),
      storage: { get: async () => null, set: async () => {} },
      listProjects: () => PROJECTS,
      ...over,
    } as unknown as ModuleHost;
    return { host, calls, cacheSets, opened, toasts };
  }

  function makePr(partial?: Partial<MonitoredPr>): MonitoredPr {
    return {
      url: 'https://github.com/acme/webapp/pull/42',
      repo: 'acme/webapp',
      number: 42,
      title: '@W-12345678: Fix the thing',
      baseRefName: 'main',
      headRefName: 'fix/the-thing',
      status: 'green',
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      checks: [{ name: 'ci', state: 'SUCCESS' }],
      addedAt: Date.now() - 1000,
      lastChecked: Date.now(),
      lastStatusChange: Date.now() - 500,
      createdAt: Date.now() - 3600000,
      updatedAt: Date.now() - 120000,
      author: { login: 'octocat', name: 'Octo Cat' },
      isDraft: false,
      body: 'This PR fixes the thing.',
      workItem: 'W-12345678',
      source: 'manual',
      lastSeenAt: Date.now(),
      reviewers: [
        { login: 'alice', name: 'Alice', state: 'approved' },
        { login: 'bob', state: 'review-requested' },
        { login: 'cara', state: 'changes-requested' },
      ],
      ...partial,
    };
  }

  function mount(pr: MonitoredPr, over?: {
    host?: ModuleHost;
    onClose?: () => void;
    onDismiss?: (u: string) => void;
    onProjectAssign?: (u: string, id: string | null) => void;
    workItemLocatorBase?: string;
    sfciGated?: boolean;
  }) {
    const made = over?.host ? { host: over.host, calls: [], cacheSets: [], opened: [], toasts: [] } : makeHost();
    const onClose = over?.onClose ?? (() => {});
    const onDismiss = over?.onDismiss ?? (() => {});
    const { unmount } = render(
      <PrDetailModal
        pr={pr}
        host={made.host}
        projects={PROJECTS}
        workItemLocatorBase={over?.workItemLocatorBase}
        sfciGated={over?.sfciGated}
        onClose={onClose}
        onDismiss={onDismiss}
        onProjectAssign={over?.onProjectAssign ?? (() => {})}
      />
    );
    unmountFn = unmount;
    return { ...made, onClose, onDismiss };
  }

  function dialog() {
    return document.querySelector('.prm-modal--detail');
  }

  it('renders identity, description, branches, reviewers, and checks', () => {
    mount(makePr());
    expect(dialog()?.getAttribute('role')).toBe('dialog');
    expect(document.getElementById('prm-detail-title')?.textContent).toContain('#42');
    expect(document.getElementById('prm-detail-title')?.textContent).toContain('acme/webapp');
    expect(dialog()?.querySelector('.prm-detail-pr-title')?.textContent).toContain('Fix the thing');
    expect(dialog()?.querySelector('.prm-status-pill')?.textContent).toMatch(/passing/i);
    expect(dialog()?.querySelector('.prm-detail-desc')?.textContent).toContain('fixes the thing');
    expect(dialog()?.querySelector('.prm-branch')?.textContent).toContain('fix/the-thing → main');
    expect(dialog()?.querySelector('.prm-reviewers--approved')).toBeTruthy();
    expect(dialog()?.querySelector('.prm-reviewers--requested')).toBeTruthy();
    expect(dialog()?.querySelector('.prm-reviewers--changes')).toBeTruthy();
    expect(dialog()?.querySelector('.prm-check-name')?.textContent).toBe('ci');
    expect(dialog()?.querySelector('.prm-workitem-chip')?.textContent).toContain('W-12345678');
    expect(dialog()?.querySelector('.prm-detail-fact dd')?.textContent).toContain('Octo Cat');
  });

  it('closes on Escape, backdrop click, and the close button', () => {
    const closed: number[] = [];
    mount(makePr(), { onClose: () => closed.push(1) });
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(document.querySelector('[data-testid="prm-detail-backdrop"]')!);
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[title="Close"]')!);
    expect(closed).toHaveLength(3);
  });

  it('does not close when clicking inside the dialog', () => {
    const closed: number[] = [];
    mount(makePr(), { onClose: () => closed.push(1) });
    fireEvent.click(dialog()!);
    expect(closed).toEqual([]);
  });

  it('ignores non-Escape keys', () => {
    const closed: number[] = [];
    mount(makePr(), { onClose: () => closed.push(1) });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(closed).toEqual([]);
  });

  it('opens a safe GitHub URL', () => {
    const { opened } = mount(makePr());
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[title="Open on GitHub"]')!);
    expect(opened).toEqual(['https://github.com/acme/webapp/pull/42']);
  });

  it('refuses a non-http URL and a malformed URL', () => {
    const a = mount(makePr({ url: 'file:///etc/passwd' }));
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[title="Open on GitHub"]')!);
    expect(a.toasts[0]?.message).toContain('Refusing');
    unmountFn?.();
    const b = mount(makePr({ url: 'not-a-url' }));
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[title="Open on GitHub"]')!);
    expect(b.toasts[0]?.message).toContain('Refusing');
  });

  it('copies the PR link and the branch name', async () => {
    const { toasts } = mount(makePr());
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Copy link"]')!);
    await Promise.resolve();
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Copy branch name"]')!);
    await Promise.resolve();
    expect(copyText).toHaveBeenCalledWith('https://github.com/acme/webapp/pull/42');
    expect(copyText).toHaveBeenCalledWith('fix/the-thing');
    expect(toasts.map((t) => t.message)).toEqual(['PR link copied', 'Branch name copied']);
  });

  it('toasts when copy fails', async () => {
    copyText.mockResolvedValueOnce(false);
    const { toasts } = mount(makePr());
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Copy link"]')!);
    await Promise.resolve();
    expect(toasts[0]?.message).toContain('Failed to copy');
  });

  it('toggles favorite, mute, and seen, and writes the cache on success', async () => {
    const { calls, cacheSets } = mount(makePr({ favorite: false, muted: false, lastSeenAt: Date.now() }));
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Favorite"]')!);
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Mute"]')!);
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Mark unread"]')!);
    await Promise.resolve();
    expect(calls.map((c) => c.handler)).toEqual(['setPrFavorite', 'setPrMuted', 'markPrAsUnseen']);
    expect(cacheSets.length).toBeGreaterThan(0);
  });

  it('unfavorites, unmutes, and marks an unread PR read', async () => {
    const { calls } = mount(
      makePr({ favorite: true, muted: true, lastSeenAt: 0, lastStatusChange: Date.now() })
    );
    expect(dialog()?.querySelector('button[aria-label="Unfavorite"]')).toBeTruthy();
    expect(dialog()?.textContent).toContain('Muted');
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Unfavorite"]')!);
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Unmute"]')!);
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Mark read"]')!);
    await Promise.resolve();
    expect(calls.map((c) => c.handler)).toEqual(['setPrFavorite', 'setPrMuted', 'markPrAsSeen']);
  });

  it('does not update the cache when an action fails', async () => {
    const { host, cacheSets } = makeHost();
    (host as { call: ModuleHost['call'] }).call = async () => ({ ok: false });
    mount(makePr(), { host });
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Favorite"]')!);
    await Promise.resolve();
    expect(cacheSets).toEqual([]);
  });

  it('does not update the cache when ok has no prs list', async () => {
    const { host, cacheSets } = makeHost();
    (host as { call: ModuleHost['call'] }).call = async () => ({ ok: true });
    mount(makePr(), { host });
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Favorite"]')!);
    await Promise.resolve();
    expect(cacheSets).toEqual([]);
  });

  it('dismisses from the footer', () => {
    const dismissed: string[] = [];
    mount(makePr(), { onDismiss: (u) => dismissed.push(u) });
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]')!);
    expect(dismissed).toEqual(['https://github.com/acme/webapp/pull/42']);
  });

  it('retries a stale sync', async () => {
    const { calls } = mount(makePr({ syncError: 'timeout' }));
    expect(dialog()?.querySelector('.prm-detail-sync-error')?.textContent).toContain('timeout');
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('button[aria-label="Retry syncing this PR"]')!);
    await Promise.resolve();
    expect(calls.some((c) => c.handler === 'retryPr')).toBe(true);
  });

  it('opens a work-item locator link', () => {
    const { opened } = mount(makePr(), { workItemLocatorBase: 'https://gus.example/locator' });
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('.prm-workitem-chip--link')!);
    expect(opened).toEqual(['https://gus.example/locator/W-12345678']);
  });

  it('extracts a work item from the title when the field is missing', () => {
    mount(makePr({ workItem: undefined, title: '@W-12345678: extracted title' }));
    expect(dialog()?.querySelector('.prm-workitem-chip')?.textContent).toContain('W-12345678');
    expect(dialog()?.querySelector('.prm-detail-pr-title')?.textContent).toContain('extracted title');
  });

  it('renders a title without a work-item prefix', () => {
    mount(makePr({ workItem: undefined, title: 'Plain title', headRefName: 'feature/x', body: '' }));
    expect(dialog()?.querySelector('.prm-workitem-chip')).toBeNull();
    expect(dialog()?.querySelector('.prm-detail-pr-title')?.textContent).toBe('Plain title');
  });

  it('omits optional sections when the PR has no author, body, branches, or reviewers', () => {
    mount(
      makePr({
        author: undefined,
        body: undefined,
        headRefName: undefined,
        baseRefName: undefined,
        reviewers: [],
        checks: [],
        createdAt: undefined,
        updatedAt: undefined,
        lastChecked: 0,
        lastStatusChange: 0,
      })
    );
    expect(dialog()?.querySelector('.prm-detail-desc')).toBeNull();
    expect(dialog()?.querySelector('.prm-detail-branch')).toBeNull();
    expect(dialog()?.querySelector('.prm-reviewers')).toBeNull();
    expect(dialog()?.querySelector('.prm-checks-empty')?.textContent).toMatch(/No check/);
  });

  it('shows merge hints for conflict, blocked, behind, dirty, and unstable', () => {
    const cases: Array<[Partial<MonitoredPr>, string]> = [
      [{ mergeable: 'CONFLICTING' }, 'Has merge conflicts'],
      [{ mergeStateStatus: 'DIRTY' }, 'Has merge conflicts'],
      [{ mergeStateStatus: 'BLOCKED' }, 'Merge blocked'],
      [{ mergeStateStatus: 'BEHIND' }, 'Branch is behind the base'],
      [{ mergeStateStatus: 'UNSTABLE' }, 'Merge state unstable'],
    ];
    for (const [partial, hint] of cases) {
      mount(makePr(partial));
      expect(dialog()?.querySelector('.prm-detail-hint')?.textContent).toBe(hint);
      unmountFn?.();
      unmountFn = null;
    }
    mount(makePr({ mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN' }));
    expect(dialog()?.querySelector('.prm-detail-hint')).toBeNull();
  });

  it('shows a Draft chip and merged/closed state icons', () => {
    mount(makePr({ isDraft: true }));
    expect(dialog()?.querySelector('.prm-draft-pill')?.textContent).toContain('Draft');
    unmountFn?.();
    mount(makePr({ status: 'closed-merged', isDraft: false }));
    expect(dialog()?.querySelector('.prm-status-pill')?.textContent).toMatch(/Merged/i);
    unmountFn?.();
    mount(makePr({ status: 'closed-abandoned', isDraft: false }));
    expect(dialog()?.querySelector('.prm-status-pill')?.textContent).toMatch(/Closed/i);
  });

  it('shows Merge stalled when a ready PR sits in yellow past the danger bar', () => {
    mount(
      makePr({
        status: 'yellow',
        reviewDecision: 'APPROVED',
        buildHappy: true,
        lastStatusChange: Date.now() - 8 * 60 * 60 * 1000,
        checks: [{ name: 'ci', state: 'SUCCESS' }],
      })
    );
    expect(dialog()?.textContent).toMatch(/Merge stalled/);
  });

  it('shows a review clock for an open PR waiting on review', () => {
    mount(
      makePr({
        isDraft: false,
        status: 'review-required',
        reviewDecision: 'REVIEW_REQUIRED',
        reviewClockStartedAt: Date.now() - 6 * 24 * 60 * 60 * 1000,
      })
    );
    expect(dialog()?.querySelector('.prm-tis--review')?.textContent).toMatch(/Review stalled|Review slow|Review/);
  });

  it('shows Review ✓ when the PR is approved and unmerged', () => {
    mount(
      makePr({
        status: 'green',
        reviewDecision: 'APPROVED',
        reviewClockStartedAt: Date.now() - 1000,
        checks: [{ name: 'ci', state: 'SUCCESS' }],
      })
    );
    expect(dialog()?.textContent).toMatch(/Review ✓/);
  });

  it('hides the review pill on a draft', () => {
    mount(makePr({ isDraft: true, reviewClockStartedAt: Date.now() }));
    expect(dialog()?.querySelector('.prm-tis--review')).toBeNull();
  });

  it('renders a project association control and forwards assign', () => {
    const assigned: Array<[string, string | null]> = [];
    mount(makePr({ projectId: 'proj-a' }), {
      onProjectAssign: (url, id) => assigned.push([url, id]),
    });
    expect(dialog()?.querySelector('.prm-project-row')?.textContent).toContain('Alpha');
    fireEvent.click(dialog()!.querySelector<HTMLButtonElement>('.prm-project-row')!);
    const clear = Array.from(document.querySelectorAll<HTMLButtonElement>('.prm-project-menu-item')).find(
      (b) => b.textContent === 'Clear association'
    );
    fireEvent.click(clear!);
    expect(assigned).toEqual([['https://github.com/acme/webapp/pull/42', null]]);
  });

  it('still offers copy-branch when only the head ref is present', () => {
    mount(makePr({ baseRefName: undefined, headRefName: 'only-head' }));
    expect(dialog()?.querySelector('.prm-branch')?.textContent).toContain('only-head → ?');
  });

  it('falls back to login when the author has no display name, and copies nothing without a head branch', () => {
    mount(
      makePr({
        author: { login: 'solo' },
        headRefName: undefined,
        baseRefName: 'main',
      })
    );
    expect(dialog()?.querySelector('.prm-detail-fact dd')?.textContent).toContain('solo');
    expect(dialog()?.querySelector('button[aria-label="Copy branch name"]')).toBeNull();
    expect(dialog()?.querySelector('.prm-branch')?.textContent).toContain('? → main');
  });
});
