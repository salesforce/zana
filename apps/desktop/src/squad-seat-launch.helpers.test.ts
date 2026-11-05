import { describe, expect, it, vi } from 'vitest';
import type { Persona } from '@zana-ai/zcc-domain/product';
import { restoreSpawnOptions, SQUAD_SEAT_MARKER, squadSeatMarkerFor, squadSeatRefusal } from './squad-seat-launch.js';

const persona = (id: string, over: Partial<Persona> = {}) => ({ id, name: id, baseProfile: 'claude', ...over }) as Persona;
const base = (over: Record<string, unknown> = {}) => {
  const revoke = vi.fn();
  return {
    revoke,
    input: {
      transport: 'CLI' as string | undefined,
      expectedSlots: [{ slotId: '0:a:0', personaId: 'a' }],
      personas: [persona('a')],
      profileFor: (id: string) => ((id === 'a' ? 'claude' : id) as never),
      personaName: (id: string) => id.toUpperCase(),
      coordinationMode: 'structured' as string | undefined,
      project: {} as { remote?: unknown },
      platform: 'darwin' as NodeJS.Platform,
      revoke,
      ...over
    }
  };
};

describe('squadSeatRefusal', () => {
  it('returns nothing for a Claude seat and does not revoke', () => {
    const { input, revoke } = base();
    expect(squadSeatRefusal(input as never)).toBeUndefined();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('skips the Modern transport entirely (REQ-14)', () => {
    const { input, revoke } = base({ transport: 'MODERN', profileFor: () => 'cursor' });
    expect(squadSeatRefusal(input as never)).toBeUndefined();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('returns the finished refusal and revokes the request authorizations', () => {
    const { input, revoke } = base({ profileFor: () => 'cursor' });
    const refused = squadSeatRefusal(input as never);
    expect(refused).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
    expect(refused?.message).toMatch(/A can't run on .*execution tools/);
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('marks a Codex seat with persona instructions on a remote project as refused, but not locally', () => {
    const personas = [persona('a', { baseProfile: 'codex', appendSystemPrompt: 'role' })];
    const local = base({ personas, profileFor: () => 'codex' });
    expect(squadSeatRefusal(local.input as never)).toBeUndefined();
    const remote = base({ personas, profileFor: () => 'codex', project: { remote: { host: 'h' } } });
    expect(squadSeatRefusal(remote.input as never)?.message).toMatch(/persona instructions on a remote project/);
  });

  it('treats a missing persona as having neither instructions nor denies', () => {
    const { input } = base({ personas: [] });
    expect(squadSeatRefusal(input as never)).toBeUndefined();
  });
});

describe('squadSeatMarkerFor and restoreSpawnOptions', () => {
  const cohort = (slotId: string | undefined) => ({ cohortId: 'c', teamId: 't', teamName: 'T', role: 'worker' as const, slotId });

  it('marks a team cohort seat, including an orchestrator', () => {
    expect(squadSeatMarkerFor({ cohort: cohort('0:a:0') })).toEqual(SQUAD_SEAT_MARKER);
    expect(squadSeatMarkerFor({ cohort: { ...cohort('orchestrator:o'), role: 'orchestrator' } })).toEqual(SQUAD_SEAT_MARKER);
    expect(squadSeatMarkerFor({ cohort: cohort(undefined) })).toEqual(SQUAD_SEAT_MARKER);
  });

  it('does not mark an orchestrator-child or a launch with no cohort', () => {
    expect(squadSeatMarkerFor({ cohort: cohort('orchestrator-child:abc') })).toEqual({});
    expect(squadSeatMarkerFor({})).toEqual({});
  });

  it('adds the marker to existing options, creates options when none, and leaves unmarked options alone', () => {
    expect(restoreSpawnOptions({ preallocatedSessionId: 's' }, { cohort: cohort('0:a:0') })).toEqual({ preallocatedSessionId: 's', squadSeat: true });
    expect(restoreSpawnOptions(undefined, { cohort: cohort('0:a:0') })).toEqual({ squadSeat: true });
    const opts = { preallocatedSessionId: 's' };
    expect(restoreSpawnOptions(opts, {})).toBe(opts);
    expect(restoreSpawnOptions(undefined, {})).toBeUndefined();
  });
});
