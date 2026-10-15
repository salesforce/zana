import { describe, expect, it } from 'vitest';
import {
  EMPTY_HOST_INSTALL_DRAWER,
  formatHostInstallDuration,
  reduceHostInstallEvent,
  reduceHostInstallOpen,
  resolveStageDisplay,
  upsertStage
} from './host-install-drawer.js';

describe('host install stages', () => {
  it('formats durations as m:ss', () => {
    expect(formatHostInstallDuration(0)).toBe('0:00');
    expect(formatHostInstallDuration(65_900)).toBe('1:05');
    expect(formatHostInstallDuration(-5)).toBe('0:00');
  });

  it('upserts by stage in arrival order and records startedAt on running', () => {
    let stages = upsertStage([], { type: 'stage', stage: 'ssh', status: 'running', limitMs: 30_000 }, 100);
    stages = upsertStage(stages, { type: 'stage', stage: 'tunnel', status: 'running' }, 200);
    stages = upsertStage(stages, { type: 'stage', stage: 'ssh', status: 'passed' }, 300);
    expect(stages.map((s) => [s.stage, s.status])).toEqual([['ssh', 'passed'], ['tunnel', 'running']]);
    expect(stages[0]).toMatchObject({ startedAt: 100, limitMs: 30_000 });
    expect(stages[1]).toEqual({ stage: 'tunnel', status: 'running', startedAt: 200 });
    const failed = upsertStage(stages, { type: 'stage', stage: 'tunnel', status: 'failed', reason: 'refused' }, 400);
    expect(failed[1]).toEqual({ stage: 'tunnel', status: 'failed', reason: 'refused', startedAt: 200 });
    const noStart = upsertStage([], { type: 'stage', stage: 'wait', status: 'failed' }, 1);
    expect(noStart[0]).toEqual({ stage: 'wait', status: 'failed' });
  });

  it('shows a running stage past its limit as failed (display only)', () => {
    const entry = { stage: 'wait' as const, status: 'running' as const, startedAt: 0, limitMs: 60_000 };
    expect(resolveStageDisplay(entry, 30_000)).toMatchObject({ status: 'running', elapsedMs: 30_000, timedOut: false });
    expect(resolveStageDisplay(entry, 61_000)).toMatchObject({ status: 'failed', reason: 'Timed out after 1:00', timedOut: true });
    expect(resolveStageDisplay({ stage: 'ssh', status: 'running' }, 5)).toEqual({ status: 'running', timedOut: false });
    expect(resolveStageDisplay({ stage: 'ssh', status: 'failed', reason: 'x', startedAt: 10 }, 5))
      .toMatchObject({ status: 'failed', reason: 'x', elapsedMs: 0 });
  });

  it('reduces stage events into state and resets on open', () => {
    const open = reduceHostInstallOpen(EMPTY_HOST_INSTALL_DRAWER, { kind: 'install', target: 'box' });
    const next = reduceHostInstallEvent(open, { type: 'stage', stage: 'ssh', status: 'running' }, 7);
    expect(next.stages).toEqual([{ stage: 'ssh', status: 'running', startedAt: 7 }]);
    expect(reduceHostInstallOpen(next, { kind: 'install', target: 'box' }).stages).toEqual([]);
  });
});
