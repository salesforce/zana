/**
 * @vitest-environment happy-dom
 *
 * PrTile DOM tests — verify tile UI, menu interactions, unseen toggle.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ModuleHost, ProjectInfo } from './host.js';
import { PrTile } from './PrTile.js';
import { positionProjectPicker } from './PrProjectControl.js';
import type { MonitoredPr } from '../../lib/types.js';

describe('PrTile', () => {
  let cleanup: (() => void) | null = null;

  afterEach(() => {
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
  });

  function makeHost(): ModuleHost {
    const calls: Array<{ handler: string; args: unknown[] }> = [];
    return {
      call: async (handler: string, ...args: unknown[]) => {
        calls.push({ handler, args });
        if (handler === 'markPrAsSeen' || handler === 'markPrAsUnseen') {
          return { ok: true, prs: [] };
        }
        return { ok: false };
      },
      cache: {
        get: () => null,
        set: () => {},
        refreshBadge: () => {},
      },
      openExternal: () => {},
      toast: () => {},
      storage: {
        get: async () => null,
        set: async () => {},
      },
      listProjects: () => [],
      getScopedProjectId: () => null,
    } as unknown as ModuleHost;
  }

  function makePr(partial?: Partial<MonitoredPr>): MonitoredPr {
    return {
      url: 'https://github.com/owner/repo/pull/123',
      repo: 'owner/repo',
      number: 123,
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
      createdAt: Date.now() - 3600000, // 1h ago
      author: { login: 'octocat', name: 'Octo Cat' },
      isDraft: false,
      body: 'This PR fixes the thing by doing the stuff.',
      workItem: 'W-1234567',
      source: 'manual',
      ...partial,
    };
  }

  it('renders tile with work item, status pill, time-in-status, and author', () => {
    const pr = makePr();
    const { container } = render(
      <PrTile
        pr={pr}
        host={makeHost()}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();

    // Work item inline
    const workItemInline = container.querySelector('.prm-tile-workitem-inline');
    expect(workItemInline?.textContent).toContain('@W-1234567');

    // Status pill
    const statusPill = container.querySelector('.prm-status-pill');
    expect(statusPill).toBeTruthy();
    expect(statusPill?.classList.contains('prm-status-pill--green')).toBe(true);

    // Time-in-status pill: a just-changed PR (0m since lastStatusChange) reads
    // "0m" and is 'ok' (no escalation cue).
    const tis = container.querySelector('.prm-tis');
    expect(tis?.textContent).toContain('0m');
    expect(tis?.classList.contains('prm-tis--ok')).toBe(true);
    expect(container.querySelector('.prm-tis-cue')).toBeFalsy();

    // Author (initials-only avatar, plus display name)
    const authorName = container.querySelector('.prm-author-name');
    expect(authorName?.textContent).toBe('Octo Cat');
    const avatar = container.querySelector('.prm-avatar');
    expect(avatar?.classList.contains('prm-avatar--initials')).toBe(true);
    expect(avatar?.textContent).toBe('OC');
  });

  it('shows unread left bar and bold title when hasUnseenChanges', () => {
    const pr = makePr({ lastStatusChange: Date.now(), lastSeenAt: Date.now() - 1000 });
    const { container } = render(
      <PrTile
        pr={pr}
        host={makeHost()}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();

    const tile = container.querySelector('.prm-tile');
    expect(tile?.classList.contains('prm-tile--unread')).toBe(true);
  });

  it('marks an unseen PR unread WITHOUT a standalone "Updated" pill', () => {
    // Item 5: the "Updated" pill was removed — the unread left bar + bold title
    // are the sole unread indicators (class `prm-tile--unread`).
    const pr = makePr({ lastStatusChange: Date.now(), lastSeenAt: Date.now() - 1000 });
    const { container } = render(
      <PrTile
        pr={pr}
        host={makeHost()}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();

    expect(container.querySelector('.prm-updated-pill')).toBeNull();
    expect(container.querySelector('.prm-tile')?.classList.contains('prm-tile--unread')).toBe(true);
  });

  it('shows an explicitly marked unread PR even without a status change', () => {
    const now = Date.now();
    const pr = makePr({ addedAt: now, lastStatusChange: now, lastSeenAt: 0 });
    const { container } = render(
      <PrTile
        pr={pr}
        host={makeHost()}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();

    expect(container.querySelector('.prm-tile')?.classList.contains('prm-tile--unread')).toBe(true);
  });

  it('shows Draft pill when isDraft', () => {
    const pr = makePr({ isDraft: true });
    const { container } = render(
      <PrTile
        pr={pr}
        host={makeHost()}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();

    const draftPill = container.querySelector('.prm-draft-pill');
    expect(draftPill).toBeTruthy();
    expect(draftPill?.textContent).toBe('Draft');
  });

  it('renders branch line with head → base', () => {
    const pr = makePr({ headRefName: 'fix/thing', baseRefName: 'main' });
    const { container } = render(
      <PrTile
        pr={pr}
        host={makeHost()}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();

    const branch = container.querySelector('.prm-branch');
    expect(branch?.textContent).toContain('fix/thing → main');
  });

  it('renders body description clamped to 2 lines', () => {
    const pr = makePr({ body: 'This is a long description that should be clamped to two lines.' });
    const { container } = render(
      <PrTile
        pr={pr}
        host={makeHost()}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();

    const desc = container.querySelector('.prm-desc');
    expect(desc?.textContent).toBe('This is a long description that should be clamped to two lines.');
  });

  it('marks PR as seen on tile click when unseen', async () => {
    const calls: Array<{ handler: string; args: unknown[] }> = [];
    const host = {
      ...makeHost(),
      call: async (handler: string, ...args: unknown[]) => {
        calls.push({ handler, args });
        if (handler === 'markPrAsSeen') {
          return { ok: true, prs: [] };
        }
        return { ok: false };
      },
    } as unknown as ModuleHost;

    const pr = makePr({ lastStatusChange: Date.now(), lastSeenAt: Date.now() - 1000 });
    const { container } = render(
      <PrTile
        pr={pr}
        host={host}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();

    const tile = container.querySelector('.prm-tile') as HTMLElement;
    tile.click();

    await waitFor(() => {
      expect(calls.length).toBe(1);
      expect(calls[0].handler).toBe('markPrAsSeen');
    });
  });

  it('renders an initials avatar, never an <img> (no renderer network egress)', () => {
    // AC-LIST-16.2a: the renderer must not issue its own image request. Author
    // avatars are always drawn as initials — there is no avatarUrl <img> path.
    const pr = makePr({ author: { login: 'octocat', name: 'Octo Cat' } });
    const { container } = render(
      <PrTile
        pr={pr}
        host={makeHost()}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();

    const avatar = container.querySelector('.prm-avatar');
    expect(avatar).toBeTruthy();
    expect(avatar?.tagName).toBe('SPAN');
    expect(avatar?.classList.contains('prm-avatar--initials')).toBe(true);
    expect(avatar?.textContent).toBe('OC');
    expect(container.querySelector('img')).toBeFalsy();
  });

  it('derives initials from login when name is absent', () => {
    const pr = makePr({ author: { login: 'octocat' } });
    const { container } = render(
      <PrTile
        pr={pr}
        host={makeHost()}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();

    const avatar = container.querySelector('.prm-avatar--initials');
    expect(avatar?.textContent).toBe('OC');
  });

  it('escalates the BUILD pill to danger with a "Build stalled" cue (AC-LIST-14.1)', () => {
    // 7h since lastStatusChange, default build danger threshold 6h → 'Build stalled'.
    // Empty checks → build not happy → the build clock escalates.
    const pr = makePr({ lastStatusChange: Date.now() - 7 * 60 * 60 * 1000, checks: [] });
    const { container } = render(
      <PrTile
        pr={pr}
        host={makeHost()}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();

    const tis = container.querySelector('.prm-tis');
    expect(tis?.classList.contains('prm-tis--danger')).toBe(true);
    expect(tis?.textContent).toContain('7h');
    // Non-color cue for colorblind users (AC-LIST-13.2), gate-named (§6.4).
    expect(container.querySelector('.prm-tis-cue')?.textContent).toContain('Build stalled');
  });

  it('a build-happy PR shows a passive "Build ✓" done-state, never stalls (AC-LIST-13.7/14.6)', () => {
    // All checks passing + far past danger → build is done, not stalled.
    const pr = makePr({
      status: 'green',
      lastStatusChange: Date.now() - 99 * 60 * 60 * 1000,
      checks: [{ name: 'CI', state: 'SUCCESS', bucket: 'pass' }],
    });
    const { container } = render(
      <PrTile pr={pr} host={makeHost()} projects={[]} onDismiss={() => {}} onProjectAssign={() => {}} selected={false} onToggleSelect={() => {}} />
    );
    cleanup = () => container.remove();
    const build = container.querySelector('.prm-tis');
    expect(build?.classList.contains('prm-tis--done')).toBe(true);
    expect(build?.classList.contains('prm-tis--danger')).toBe(false);
    expect(container.querySelector('.prm-tis-cue')?.textContent).toContain('Build ✓');
  });

  it('a Draft shows the build pill but NO review pill (AC-LIST-25.1)', () => {
    const pr = makePr({ isDraft: true, checks: [], reviewClockStartedAt: Date.now() - 2 * 86400000 });
    const { container } = render(
      <PrTile pr={pr} host={makeHost()} projects={[]} onDismiss={() => {}} onProjectAssign={() => {}} selected={false} onToggleSelect={() => {}} />
    );
    cleanup = () => container.remove();
    // Exactly one pill (build); no review pill on a Draft.
    expect(container.querySelectorAll('.prm-tis').length).toBe(1);
    expect(container.querySelector('.prm-tis--review')).toBeNull();
  });

  it('an approved-but-unmerged Open PR shows a passive "Review ✓" (AC-LIST-25.5)', () => {
    const pr = makePr({
      status: 'yellow',
      isDraft: false,
      reviewDecision: 'APPROVED',
      reviewClockStartedAt: Date.now() - 10 * 86400000,
      checks: [{ name: 'CI', state: 'SUCCESS', bucket: 'pass' }],
    });
    const { container } = render(
      <PrTile pr={pr} host={makeHost()} projects={[]} onDismiss={() => {}} onProjectAssign={() => {}} selected={false} onToggleSelect={() => {}} />
    );
    cleanup = () => container.remove();
    const review = container.querySelector('.prm-tis--review');
    expect(review).toBeTruthy();
    expect(review?.classList.contains('prm-tis--done')).toBe(true);
    expect(review?.textContent).toContain('Review ✓');
  });

  it('the review pill doubles as the per-check disclosure toggle, like the build pill (§6.4)', () => {
    // An Open, non-Draft PR with checks: BOTH pills open/close the check list.
    const pr = makePr({
      status: 'review-required',
      isDraft: false,
      reviewClockStartedAt: Date.now() - 2 * 86400000,
      checks: [
        { name: 'CI', state: 'SUCCESS', bucket: 'pass' },
        { name: 'lint', state: 'FAILURE', bucket: 'fail' },
      ],
    });
    const { container } = render(
      <PrTile pr={pr} host={makeHost()} projects={[]} onDismiss={() => {}} onProjectAssign={() => {}} selected={false} onToggleSelect={() => {}} />
    );
    cleanup = () => container.remove();
    const review = container.querySelector('.prm-tis--review') as HTMLElement;
    expect(review).toBeTruthy();
    // It's an interactive toggle surface (role=button, tracks aria-expanded).
    expect(review.classList.contains('prm-checks-trigger')).toBe(true);
    expect(review.getAttribute('role')).toBe('button');
    expect(review.getAttribute('aria-expanded')).toBe('false');
    // Clicking the review pill reveals the checks, same as the build pill.
    expect(container.querySelector('.prm-tile-checks')).toBeFalsy();
    fireEvent.click(review);
    expect(container.querySelector('.prm-tile-checks')).toBeTruthy();
    expect(review.getAttribute('aria-expanded')).toBe('true');
    // And clicking again collapses.
    fireEvent.click(review);
    expect(container.querySelector('.prm-tile-checks')).toBeFalsy();
  });

  it('a review pill with no checks stays inert (no toggle role) (§6.4)', () => {
    const pr = makePr({
      status: 'review-required',
      isDraft: false,
      reviewClockStartedAt: Date.now() - 2 * 86400000,
      checks: [],
    });
    const { container } = render(
      <PrTile pr={pr} host={makeHost()} projects={[]} onDismiss={() => {}} onProjectAssign={() => {}} selected={false} onToggleSelect={() => {}} />
    );
    cleanup = () => container.remove();
    const review = container.querySelector('.prm-tis--review') as HTMLElement;
    expect(review).toBeTruthy();
    expect(review.classList.contains('prm-checks-trigger')).toBe(false);
    expect(review.getAttribute('role')).toBeNull();
  });

  it('a merge-blocked, approved, build-happy PR reads "Merge stalled" on the BUILD pill (AC-LIST-14.7)', () => {
    // yellow (Merge blocked) + approved + all checks pass + past build danger → merge-stall.
    const pr = makePr({
      status: 'yellow',
      isDraft: false,
      reviewDecision: 'APPROVED',
      lastStatusChange: Date.now() - 8 * 60 * 60 * 1000,
      checks: [{ name: 'CI', state: 'SUCCESS', bucket: 'pass' }],
    });
    const { container } = render(
      <PrTile pr={pr} host={makeHost()} projects={[]} onDismiss={() => {}} onProjectAssign={() => {}} selected={false} onToggleSelect={() => {}} />
    );
    cleanup = () => container.remove();
    // Build pill (first .prm-tis) carries the merge-stall label at danger color.
    const build = container.querySelector('.prm-tis');
    expect(build?.classList.contains('prm-tis--danger')).toBe(true);
    expect(build?.textContent).toContain('Merge stalled');
    // Merge-stall lives on the build pill, NOT the review pill.
    expect(container.querySelector('.prm-tis--review')?.textContent).not.toContain('Merge stalled');
  });

  it('a gated Draft with no SFCI-job comment never build-stalls (AC-LIST-14.5)', () => {
    const pr = makePr({
      status: 'pending',
      isDraft: true,
      lastStatusChange: Date.now() - 99 * 60 * 60 * 1000,
      checks: [],
      hasSfciJob: false,
    });
    const { container } = render(
      <PrTile pr={pr} host={makeHost()} projects={[]} sfciGated onDismiss={() => {}} onProjectAssign={() => {}} selected={false} onToggleSelect={() => {}} />
    );
    cleanup = () => container.remove();
    const build = container.querySelector('.prm-tis');
    // blocked → calm clock, not danger, no "stalled" cue.
    expect(build?.classList.contains('prm-tis--danger')).toBe(false);
    expect(container.querySelector('.prm-tis-cue')?.textContent ?? '').not.toContain('stalled');
  });

  it('renders all row actions inline, no ⋯ overflow menu (AC-LIST-19.1)', () => {
    // Item 7: the responsive ⋯ overflow was removed — every action is an inline
    // icon button on the row (Mark read/unread · Favorite/Unfavorite · Mute/Unmute
    // · Dismiss).
    const pr = makePr();
    const { container } = render(
      <PrTile
        pr={pr}
        host={makeHost()}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();

    // No overflow trigger and no portaled menu at any width.
    expect(container.querySelector('.prm-tile-menu-btn')).toBeNull();
    expect(document.querySelector('.prm-tile-menu')).toBeNull();

    const actions = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.prm-tile-actions .prm-tile-icon-btn')
    ).map((b) => b.getAttribute('aria-label'));
    // Default fixture is unread (lastStatusChange > addedAt) → "Mark read"; not
    // favorite → "Favorite"; not muted → "Mute".
    expect(actions).toEqual(['Mark read', 'Favorite', 'Mute', 'Dismiss']);
  });

  it('toggles favorite via the inline row action (setPrFavorite)', async () => {
    const calls: Array<{ handler: string; args: unknown[] }> = [];
    const host = {
      ...makeHost(),
      call: async (handler: string, ...args: unknown[]) => {
        calls.push({ handler, args });
        return { ok: true, prs: [] };
      },
    } as unknown as ModuleHost;
    const pr = makePr();
    const { container } = render(
      <PrTile
        pr={pr}
        host={host}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();

    const favBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.prm-tile-actions .prm-tile-icon-btn')
    ).find((b) => b.getAttribute('aria-label') === 'Favorite')!;
    favBtn.click();
    await waitFor(() => {
      const call = calls.find((c) => c.handler === 'setPrFavorite');
      expect(call).toBeTruthy();
      expect(call!.args[0]).toEqual({ url: pr.url, favorite: true });
    });
  });

  it('favorite row action + tile reflect the favorite state (star fill, gold, --favorite class)', () => {
    const render1 = (favorite: boolean) => {
      const { container } = render(
        <PrTile
          pr={makePr({ favorite })}
          host={makeHost()}
          projects={[]}
          onDismiss={() => {}}
          onProjectAssign={() => {}}
          selected={false}
          onToggleSelect={() => {}}
        />
      );
      cleanup = () => container.remove();
      const label = favorite ? 'Unfavorite' : 'Favorite';
      const btn = Array.from(
        container.querySelectorAll<HTMLButtonElement>('.prm-tile-actions .prm-tile-icon-btn')
      ).find((b) => b.getAttribute('aria-label') === label)!;
      const tile = container.querySelector('.prm-tile')!;
      return { btn, tile, container };
    };

    // Favorited: --active button (gold/fill), aria-pressed, and the row tint class.
    const on = render1(true);
    expect(on.btn.classList.contains('prm-tile-icon-btn--active')).toBe(true);
    expect(on.btn.getAttribute('aria-pressed')).toBe('true');
    expect(on.tile.classList.contains('prm-tile--favorite')).toBe(true);
    on.container.remove();

    // Not favorited: hollow star, no active class, no row tint.
    const off = render1(false);
    expect(off.btn.classList.contains('prm-tile-icon-btn--active')).toBe(false);
    expect(off.tile.classList.contains('prm-tile--favorite')).toBe(false);
  });

  it('toggles mute via the inline row action (setPrMuted)', async () => {
    const calls: Array<{ handler: string; args: unknown[] }> = [];
    const host = {
      ...makeHost(),
      call: async (handler: string, ...args: unknown[]) => {
        calls.push({ handler, args });
        return { ok: true, prs: [] };
      },
    } as unknown as ModuleHost;
    const pr = makePr();
    const { container } = render(
      <PrTile
        pr={pr}
        host={host}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();

    const muteBtn = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.prm-tile-actions .prm-tile-icon-btn')
    ).find((b) => b.getAttribute('aria-label') === 'Mute')!;
    muteBtn.click();
    await waitFor(() => {
      const call = calls.find((c) => c.handler === 'setPrMuted');
      expect(call).toBeTruthy();
      expect(call!.args[0]).toEqual({ url: pr.url, muted: true });
    });
  });

  it('mute row action icon mirrors the current state (Bell when active, BellOff when muted)', () => {
    // Regression: the icon must match the .prm-mute-indicator convention
    // (BellOff = muted). An active PR shows the ringing Bell + "Mute" action; a
    // muted PR shows the silenced BellOff + "Unmute" action. Previously inverted.
    const muteIcon = (muted: boolean) => {
      const { container } = render(
        <PrTile
          pr={makePr({ muted })}
          host={makeHost()}
          projects={[]}
          onDismiss={() => {}}
          onProjectAssign={() => {}}
          selected={false}
          onToggleSelect={() => {}}
        />
      );
      cleanup = () => container.remove();
      const label = muted ? 'Unmute' : 'Mute';
      const btn = Array.from(
        container.querySelectorAll<HTMLButtonElement>('.prm-tile-actions .prm-tile-icon-btn')
      ).find((b) => b.getAttribute('aria-label') === label)!;
      return btn.querySelector('svg')!.getAttribute('class') ?? '';
    };
    expect(muteIcon(false)).toContain('lucide-bell');
    expect(muteIcon(false)).not.toContain('lucide-bell-off');
    expect(muteIcon(true)).toContain('lucide-bell-off');
  });

  it('shows the mute indicator when the PR is muted (AC-LIST-18.3)', () => {
    const pr = makePr({ muted: true });
    const { container } = render(
      <PrTile
        pr={pr}
        host={makeHost()}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();
    expect(container.querySelector('.prm-mute-indicator')).toBeTruthy();
  });

  it('renders reviewers grouped by state with initials avatars (AC-LIST-16.1)', () => {
    const pr = makePr({
      reviewers: [
        { login: 'alice', name: 'Alice A', state: 'approved' },
        { login: 'bob', state: 'changes-requested' },
        { login: 'carol', name: 'Carol C', state: 'review-requested' },
      ],
    });
    const { container } = render(
      <PrTile
        pr={pr}
        host={makeHost()}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();
    const groups = container.querySelectorAll('.prm-reviewers-group');
    expect(groups.length).toBe(3);
    // Group order: changes-requested, review-requested, approved.
    expect(container.querySelector('.prm-reviewers--changes')).toBeTruthy();
    expect(container.querySelector('.prm-reviewers--requested')).toBeTruthy();
    expect(container.querySelector('.prm-reviewers--approved')).toBeTruthy();
    // Reviewer avatars are initials, never <img>.
    expect(container.querySelector('.prm-reviewer-avatar')?.tagName).toBe('SPAN');
  });

  it('shows check-status summary pips and no reserved space when there are no checks (AC-LIST-21.4)', () => {
    const withChecks = makePr({
      checks: [
        { name: 'build', state: 'SUCCESS' },
        { name: 'test', state: 'FAILURE' },
        { name: 'lint', state: 'PENDING' },
      ],
    });
    const { container, rerender } = render(
      <PrTile
        pr={withChecks}
        host={makeHost()}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();
    expect(container.querySelector('.prm-check-pip--pass')?.textContent).toContain('1');
    expect(container.querySelector('.prm-check-pip--fail')?.textContent).toContain('1');
    expect(container.querySelector('.prm-check-pip--pending')?.textContent).toContain('1');

    rerender(
      <PrTile
        pr={makePr({ checks: [] })}
        host={makeHost()}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    expect(container.querySelector('.prm-check-pips')).toBeFalsy();
  });

  it('expands per-check disclosure to list every check run (AC-LIST-22.x)', () => {
    const pr = makePr({
      checks: [
        { name: 'build', state: 'SUCCESS' },
        { name: 'test', state: 'FAILURE' },
      ],
    });
    const { container } = render(
      <PrTile
        pr={pr}
        host={makeHost()}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();
    expect(container.querySelector('.prm-tile-checks')).toBeFalsy();
    // The status/TIS/pips surfaces double as the per-check disclosure toggle
    // when the PR has checks (there is no standalone "Checks" button anymore).
    const toggle = container.querySelector('.prm-checks-trigger') as HTMLElement;
    expect(toggle).toBeTruthy();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(container.querySelector('.prm-tile-checks')).toBeTruthy();
    expect(container.querySelectorAll('.prm-check-row').length).toBe(2);
  });

  it('shows a stale indicator + retry when the PR has a syncError (AC-LIST-23.x)', async () => {
    const calls: Array<{ handler: string; args: unknown[] }> = [];
    const host = {
      ...makeHost(),
      call: async (handler: string, ...args: unknown[]) => {
        calls.push({ handler, args });
        return { ok: true, prs: [] };
      },
    } as unknown as ModuleHost;
    const pr = makePr({ syncError: 'network unreachable' });
    const { container } = render(
      <PrTile
        pr={pr}
        host={host}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();
    const err = container.querySelector('.prm-sync-error');
    expect(err).toBeTruthy();
    expect(err?.querySelector('.prm-sync-error-text')?.textContent).toBe('stale');
    expect(container.querySelector('.prm-tile')?.classList.contains('prm-tile--stale')).toBe(true);
    (err?.querySelector('button') as HTMLButtonElement).click();
    await waitFor(() => {
      const call = calls.find((c) => c.handler === 'retryPr');
      expect(call?.args[0]).toEqual({ url: pr.url });
    });
  });

  it('project control is unassociated with no project, associated once assigned (AC-LIST-20.2)', () => {
    const projects: ProjectInfo[] = [{ id: 'proj-a', name: 'Alpha', path: '/repos/alpha' }];
    const unassigned = makePr();
    const { container, rerender } = render(
      <PrTile
        pr={unassigned}
        host={makeHost()}
        projects={projects}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();
    const ctl = container.querySelector('.prm-project-row')!;
    expect(ctl.classList.contains('prm-project-row--unassociated')).toBe(true);
    // Red-state meaning is carried in text, not hue alone.
    expect(ctl.getAttribute('aria-label')).toContain('inbox notifications disabled');
    // The row is always present and, when unassociated, reads the explicit text.
    expect(container.querySelector('.prm-project-row-name')?.textContent).toBe(
      'Not associated with a project'
    );

    rerender(
      <PrTile
        pr={makePr({ projectId: 'proj-a' })}
        host={makeHost()}
        projects={projects}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    expect(
      container.querySelector('.prm-project-row')?.classList.contains('prm-project-row--associated')
    ).toBe(true);
    // The project name appears in the row when associated (AC-LIST-20.3).
    expect(container.querySelector('.prm-project-row-name')?.textContent).toBe('Alpha');
  });

  it('refuses to open a non-http(s) PR url (AC-LIST-11.5a)', () => {
    const opened: string[] = [];
    const toasts: Array<[string, string]> = [];
    const host = {
      ...makeHost(),
      openExternal: (u: string) => opened.push(u),
      toast: (m: string, kind: string) => toasts.push([m, kind]),
    } as unknown as ModuleHost;
    const pr = makePr({ url: 'javascript:alert(1)' });
    const { container } = render(
      <PrTile
        pr={pr}
        host={host}
        projects={[]}
        onDismiss={() => {}}
        onProjectAssign={() => {}}
        selected={false}
        onToggleSelect={() => {}}
      />
    );
    cleanup = () => container.remove();
    const openBtn = Array.from(container.querySelectorAll<HTMLButtonElement>('.prm-tile-icon-btn')).find(
      (b) => b.getAttribute('title') === 'Open on GitHub'
    )!;
    openBtn.click();
    expect(opened).toEqual([]);
    expect(toasts[0][1]).toBe('error');
  });
});

describe('positionProjectPicker', () => {
  const viewport = { innerWidth: 1024, innerHeight: 768 } as Window;

  it('opens below the project row when the viewport has room', () => {
    const position = positionProjectPicker(
      { top: 100, bottom: 124, left: 100 } as DOMRect,
      viewport
    );
    expect(position).toMatchObject({ top: 128, left: 100 });
    expect(position.bottom).toBeUndefined();
  });

  it('opens above the project row and constrains a long list near the viewport bottom', () => {
    const position = positionProjectPicker(
      { top: 700, bottom: 724, left: 900 } as DOMRect,
      viewport
    );
    expect(position.top).toBeUndefined();
    expect(position.bottom).toBe(72);
    expect(position.left).toBe(736);
    expect(position.maxHeight).toBeLessThanOrEqual(320);
  });
});
