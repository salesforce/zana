import { describe, it, expect } from 'vitest';
import type { AgentRecord, TerminalSession } from '@zana-ai/zcc-domain/product';
import { SOLO_LAUNCH_ID } from '../squadFlow.js';
import {
  ALL_SQUADS,
  reconcileSquadLaunchSelection,
  squadLaunchGroups
} from '../squadLaunchGroups.js';

function agent(over: Partial<AgentRecord>): AgentRecord {
  return { sessionId: 'sid', projectId: 'p1', cwd: '/work/p1', registeredAt: 0, ...over };
}

function session(over: Partial<TerminalSession>): TerminalSession {
  return {
    id: 'sid',
    projectId: 'p1',
    title: 'claude',
    profile: 'claude',
    cwd: '/work/p1',
    status: 'running',
    createdAt: 0,
    ...over
  };
}

describe('squadLaunchGroups', () => {
  it('returns no groups for an empty mesh', () => {
    expect(squadLaunchGroups([], [])).toEqual([]);
  });

  it('groups agents by teamLaunchId and counts nodes per squad', () => {
    const groups = squadLaunchGroups(
      [
        agent({ sessionId: 'a', teamLaunchId: 'L1', registeredAt: 10 }),
        agent({ sessionId: 'b', teamLaunchId: 'L1', registeredAt: 20 }),
        agent({ sessionId: 'c', teamLaunchId: 'L2', registeredAt: 30 })
      ],
      []
    );
    const byId = new Map(groups.map((g) => [g.launchId, g]));
    expect(byId.get('L1')!.nodeCount).toBe(2);
    expect(byId.get('L2')!.nodeCount).toBe(1);
    expect(byId.get('L1')!.launchedAt).toBe(10); // earliest member
  });

  it('puts agents with no launch id into the SOLO bucket', () => {
    const groups = squadLaunchGroups([agent({ sessionId: 'x' })], []);
    expect(groups).toHaveLength(1);
    expect(groups[0].launchId).toBe(SOLO_LAUNCH_ID);
    expect(groups[0].isSolo).toBe(true);
  });

  it('counts unregistered non-shell sessions in the SOLO bucket; skips shells and registered dups', () => {
    const groups = squadLaunchGroups(
      [agent({ sessionId: 'reg', teamLaunchId: 'L1' })],
      [
        session({ id: 'reg' }), // already a registry agent → not double counted
        session({ id: 'adhoc' }), // unregistered → solo
        session({ id: 'sh', profile: 'shell' }) // shell → ignored
      ]
    );
    const byId = new Map(groups.map((g) => [g.launchId, g]));
    expect(byId.get('L1')!.nodeCount).toBe(1);
    expect(byId.get(SOLO_LAUNCH_ID)!.nodeCount).toBe(1); // only 'adhoc'
  });

  it('orders real launches most-recent-first, with SOLO always pinned last', () => {
    const groups = squadLaunchGroups(
      [
        agent({ sessionId: 'old', teamLaunchId: 'OLD', registeredAt: 100 }),
        agent({ sessionId: 'new', teamLaunchId: 'NEW', registeredAt: 900 }),
        agent({ sessionId: 'solo', registeredAt: 999 }) // newest, but solo
      ],
      []
    );
    expect(groups.map((g) => g.launchId)).toEqual(['NEW', 'OLD', SOLO_LAUNCH_ID]);
  });
});

describe('reconcileSquadLaunchSelection', () => {
  it('defaults to the most-recent squad (first group), not ALL', () => {
    expect(reconcileSquadLaunchSelection(undefined, ['NEW', 'OLD'])).toBe('NEW');
  });

  it('keeps a still-present selection (sticky)', () => {
    expect(reconcileSquadLaunchSelection('OLD', ['NEW', 'OLD'])).toBe('OLD');
  });

  it('keeps ALL_SQUADS as a valid selection even though it is not a group id', () => {
    expect(reconcileSquadLaunchSelection(ALL_SQUADS, ['NEW', 'OLD'])).toBe(ALL_SQUADS);
  });

  it('falls back to the most-recent squad when the selection vanished', () => {
    expect(reconcileSquadLaunchSelection('GONE', ['NEW', 'OLD'])).toBe('NEW');
  });

  it('falls back to ALL when there are no groups at all', () => {
    expect(reconcileSquadLaunchSelection('GONE', [])).toBe(ALL_SQUADS);
    expect(reconcileSquadLaunchSelection(undefined, [])).toBe(ALL_SQUADS);
  });
});
