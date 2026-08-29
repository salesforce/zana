import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { LaunchTeamResult } from '@zana-ai/zcc-domain/product';

vi.mock('@/store', () => ({
  useTeams: () => [],
  useData: () => [],
  useUi: () => vi.fn(),
  usePersonas: () => []
}));
vi.mock('@/lib/windowScope', () => ({ getScopedProjectId: () => null }));
vi.mock('@/components/SquadEditor', () => ({ SquadEditor: () => null }));

import { cancelStateForResult, runTeamLaunch, runTeamLaunchExclusive, TeamLaunchStatus, menuIndexForKey, menuTabIndex } from '@/views/settings/SquadsView';

const partialResult: LaunchTeamResult = {
  launchRequestId: 'request-7',
  launched: 2,
  cohortId: 'cohort-7',
  workers: [],
  failedSlots: [
    { slotId: '2:reviewer:0', personaId: 'reviewer', reason: 'adapter unavailable' }
  ],
  workerSessionIds: ['session-a', 'session-b']
};

function findButton(node: ReactNode): ReactElement<{ onClick: () => void }> | undefined {
  if (!node || typeof node !== 'object' || !('props' in node)) return undefined;
  const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void }>;
  if (element.type === 'button') return element as ReactElement<{ onClick: () => void }>;
  const children = element.props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findButton(child);
    if (found) return found;
  }
  return undefined;
}

describe('SquadsPanel Team lifecycle result', () => {
  it('announces exact worker sessions and partial failed slot reasons', () => {
    const html = renderToStaticMarkup(
      <TeamLaunchStatus result={partialResult} cancelState={null} onCancel={() => {}} />
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('session-a');
    expect(html).toContain('session-b');
    expect(html).toContain('2:reviewer:0');
    expect(html).toContain('adapter unavailable');
  });

  it('renders native cancel button and passes only launchRequestId', () => {
    const cancel = vi.fn();
    const view = TeamLaunchStatus({ result: partialResult, cancelState: null, onCancel: cancel });
    const button = findButton(view);

    expect(button?.type).toBe('button');
    expect(button?.props).toMatchObject({ type: 'button' });
    button?.props.onClick();
    expect(cancel).toHaveBeenCalledWith('request-7');
    expect(cancel).toHaveBeenCalledWith(expect.any(String));
  });

  it('announces successful cancellation', () => {
    const html = renderToStaticMarkup(
      <TeamLaunchStatus
        result={partialResult}
        cancelState={{ kind: 'success', message: 'Canceled 2 sessions: session-a, session-b.' }}
        onCancel={() => {}}
      />
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('Canceled 2 sessions: session-a, session-b.');
  });

  it('keeps cancellation errors visible and announced', () => {
    const html = renderToStaticMarkup(
      <TeamLaunchStatus
        result={partialResult}
        cancelState={{ kind: 'error', message: 'Cancel failed: request not found.' }}
        onCancel={() => {}}
      />
    );

    expect(html).toContain('role="alert"');
    expect(html).toContain('Cancel failed: request not found.');
  });

  it('announces pending cancellation and exposes retry action', () => {
    const retry = vi.fn();
    const cancelState = cancelStateForResult({
      canceledSessionIds: [],
      pendingSessionIds: ['session-a'],
      lifecycleState: 'cancel-pending'
    });
    const view = TeamLaunchStatus({
      result: partialResult,
      cancelState,
      onCancel: retry
    });
    const html = renderToStaticMarkup(view);
    const button = findButton(view);

    expect(html).toContain('role="alert"');
    expect(html).toContain('Cancellation pending; retry. Sessions: session-a.');
    expect(html).toContain('Retry cancellation');
    expect(button?.props).not.toMatchObject({ disabled: true });
    button?.props.onClick();
    expect(retry).toHaveBeenCalledWith('request-7');
  });

  it('preserves idempotent completed cancellation copy', () => {
    expect(cancelStateForResult({
      canceledSessionIds: [],
      pendingSessionIds: [],
      lifecycleState: 'canceled'
    })).toEqual({ kind: 'success', message: 'Launch already canceled or complete.' });
  });
});

describe('SquadsPanel project menu keyboard navigation', () => {
  it('supports arrows plus Home and End with wrapping', () => {
    expect(menuIndexForKey('ArrowDown', 0, 3)).toBe(1);
    expect(menuIndexForKey('ArrowDown', 2, 3)).toBe(0);
    expect(menuIndexForKey('ArrowUp', 0, 3)).toBe(2);
    expect(menuIndexForKey('Home', 2, 3)).toBe(0);
    expect(menuIndexForKey('End', 0, 3)).toBe(2);
  });

  it('uses one roving tab stop for menu items', () => {
    expect([0, 1, 2].map((index) => menuTabIndex(index, 1))).toEqual([-1, 0, -1]);
  });
});

describe('SquadsPanel launch guard', () => {
  it('suppresses a concurrent launch and permits another after completion', async () => {
    const inFlight = { current: false };
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const launch = vi.fn().mockReturnValueOnce(firstPending).mockResolvedValueOnce(undefined);

    const first = runTeamLaunchExclusive(inFlight, launch);
    const duplicate = runTeamLaunchExclusive(inFlight, launch);

    await expect(duplicate).resolves.toBeUndefined();
    expect(launch).toHaveBeenCalledTimes(1);
    expect(inFlight.current).toBe(true);

    releaseFirst();
    await first;
    expect(inFlight.current).toBe(false);

    await runTeamLaunchExclusive(inFlight, launch);
    expect(launch).toHaveBeenCalledTimes(2);
  });

  it('converts a rejected launch into a visible result instead of rejecting', async () => {
    await expect(runTeamLaunch(() => Promise.reject(new Error('broker unavailable')))).resolves.toEqual({
      result: null,
      error: 'Launch failed: broker unavailable'
    });
  });
});
