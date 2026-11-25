import { describe, expect, it } from 'vitest';
import { inheritOptionLabel, getSettingPrecedence, precedenceHelp } from './setting-precedence.js';
import {
  DEFAULT_LAUNCH_MODE,
  isGlobalSquadTransport,
  isLaunchMode,
  isTeamTransportPref,
  MODERN_INCOMPATIBLE_SEAT_REASON,
  modernBlockedBySeats,
  resolveSquadTransport
} from './squad-transport.js';

const ui = { source: 'ui' as const };

describe('resolveSquadTransport', () => {
  it('Squad pin beats pick, caller, global and mode', () => {
    const r = resolveSquadTransport({ transport: 'CLI' }, { squadDefaultTransport: 'MODERN' }, 'thread',
      { source: 'ui', pick: 'MODERN', callerTransport: 'MODERN' });
    expect(r).toEqual({ ok: true, transport: 'CLI', source: 'squad' });
  });

  it('picker overrides inherit but not a pin', () => {
    expect(resolveSquadTransport({}, { squadDefaultTransport: 'CLI' }, 'agent', { ...ui, pick: 'MODERN' }))
      .toEqual({ ok: true, transport: 'MODERN', source: 'launch-picker' });
    expect(resolveSquadTransport({ transport: 'MODERN' }, {}, 'agent', { ...ui, pick: 'CLI' }))
      .toMatchObject({ transport: 'MODERN', source: 'squad' });
  });

  it('follows caller from CLI and Modern sessions', () => {
    for (const c of ['CLI', 'MODERN'] as const) {
      expect(resolveSquadTransport({ transport: 'CALLER' }, {}, 'agent', { source: 'agent', callerTransport: c }))
        .toEqual({ ok: true, transport: c, source: 'caller' });
    }
  });

  it('global caller default follows caller; missing config reads as caller', () => {
    expect(resolveSquadTransport({}, {}, 'agent', { source: 'agent', callerTransport: 'MODERN' }))
      .toMatchObject({ transport: 'MODERN', source: 'caller' });
    expect(resolveSquadTransport({}, { squadDefaultTransport: 'caller' }, 'agent', { source: 'agent', callerTransport: 'CLI' }))
      .toMatchObject({ transport: 'CLI', source: 'caller' });
  });

  it('no caller falls through to launch mode', () => {
    expect(resolveSquadTransport({ transport: 'CALLER' }, {}, 'agent', ui))
      .toEqual({ ok: true, transport: 'CLI', source: 'launch-mode' });
    expect(resolveSquadTransport(undefined, { squadDefaultTransport: 'follow' }, 'thread', ui))
      .toEqual({ ok: true, transport: 'MODERN', source: 'launch-mode' });
    expect(resolveSquadTransport({}, {}, undefined, ui)).toMatchObject({ transport: 'MODERN' });
  });

  it('specific global default wins over launch mode', () => {
    expect(resolveSquadTransport({}, { squadDefaultTransport: 'CLI' }, 'thread', ui))
      .toEqual({ ok: true, transport: 'CLI', source: 'global' });
  });

  it('Team resolves through last non-Team mode', () => {
    expect(resolveSquadTransport({}, { squadDefaultTransport: 'follow', composerLastTransportMode: 'agent' }, 'team', ui))
      .toMatchObject({ transport: 'CLI', source: 'launch-mode' });
    expect(resolveSquadTransport({}, { squadDefaultTransport: 'follow' }, 'team', ui))
      .toMatchObject({ transport: 'MODERN' });
  });

  it('skips a hidden Composer surface', () => {
    expect(resolveSquadTransport({}, { squadDefaultTransport: 'follow' }, 'thread', { ...ui, surfaces: { showModern: false } }))
      .toMatchObject({ transport: 'CLI' });
    expect(resolveSquadTransport({}, { squadDefaultTransport: 'follow' }, 'agent', { ...ui, surfaces: { showCliAgent: false } }))
      .toMatchObject({ transport: 'MODERN' });
  });

  it('inherited Modern falls back to CLI with a reason when blocked', () => {
    const ctx = { ...ui, modernBlockedReason: 'remote Project' };
    for (const [team, cfg] of [
      [{}, { squadDefaultTransport: 'MODERN' as const }],
      [{}, { squadDefaultTransport: 'follow' as const }]
    ] as const) {
      expect(resolveSquadTransport(team, cfg, 'thread', ctx))
        .toEqual({ ok: true, transport: 'CLI', source: 'fallback-squad-mode', fallbackReason: 'remote Project' });
    }
    expect(resolveSquadTransport({ transport: 'CALLER' }, {}, 'agent', { ...ctx, source: 'agent', callerTransport: 'MODERN' }))
      .toMatchObject({ transport: 'CLI', source: 'fallback-squad-mode' });
  });

  it('inherited CLI is unaffected by a Modern block', () => {
    expect(resolveSquadTransport({}, { squadDefaultTransport: 'CLI' }, 'thread', { ...ui, modernBlockedReason: 'x' }))
      .toMatchObject({ transport: 'CLI', source: 'global' });
  });

  it('explicit Modern pin or pick refuses when blocked', () => {
    const ctx = { ...ui, modernBlockedReason: 'remote Project' };
    const pin = resolveSquadTransport({ transport: 'MODERN' }, {}, 'agent', ctx);
    expect(pin).toMatchObject({ ok: false, source: 'squad' });
    const pick = resolveSquadTransport({}, {}, 'agent', { ...ctx, pick: 'MODERN' });
    expect(pick).toMatchObject({ ok: false, source: 'launch-picker' });
    expect(resolveSquadTransport({ transport: 'CLI' }, {}, 'thread', ctx)).toMatchObject({ ok: true, transport: 'CLI' });
    expect(resolveSquadTransport({}, {}, 'thread', { ...ctx, pick: 'CLI' })).toMatchObject({ ok: true, transport: 'CLI' });
  });

  it('on-demand or fresh-session seats block Modern: inherited falls back, explicit refuses', () => {
    const seats = { slots: [{ startOnDemand: true }] };
    const fresh = { slots: [{ freshContextPerUnit: true }] };
    const base = { source: 'ui' as const };
    const cfg = { squadDefaultTransport: 'MODERN' as const };
    for (const team of [seats, fresh]) {
      const inherited = resolveSquadTransport(team, cfg, undefined, base);
      expect(inherited).toMatchObject({ ok: true, transport: 'CLI', source: 'fallback-squad-mode' });
      expect(inherited.ok && inherited.fallbackReason).toBe(MODERN_INCOMPATIBLE_SEAT_REASON);
      expect(resolveSquadTransport({ ...team, transport: 'MODERN' }, cfg, undefined, base)).toMatchObject({ ok: false, source: 'squad' });
      expect(resolveSquadTransport(team, cfg, undefined, { ...base, pick: 'MODERN' })).toMatchObject({ ok: false, source: 'launch-picker' });
      expect(resolveSquadTransport({ ...team, transport: 'CLI' }, cfg, undefined, base)).toMatchObject({ ok: true, transport: 'CLI', source: 'squad' });
    }
    expect(modernBlockedBySeats({ slots: [{ startOnDemand: false }, {}] })).toBeUndefined();
    expect(modernBlockedBySeats(undefined)).toBeUndefined();
    expect(resolveSquadTransport({ slots: [{}] }, cfg, undefined, base)).toMatchObject({ ok: true, transport: 'MODERN' });
  });

  it('ignores unknown stored team transport values', () => {
    expect(resolveSquadTransport({ transport: 'bogus' }, { squadDefaultTransport: 'CLI' }, 'thread', ui))
      .toMatchObject({ transport: 'CLI', source: 'global' });
  });
});

describe('guards and labels', () => {
  it('type guards', () => {
    expect(isTeamTransportPref('CALLER')).toBe(true);
    expect(isTeamTransportPref('x')).toBe(false);
    expect(isGlobalSquadTransport('follow')).toBe(true);
    expect(isGlobalSquadTransport('CALLER')).toBe(false);
    expect(isLaunchMode('team')).toBe(true);
    expect(isLaunchMode('x')).toBe(false);
    expect(DEFAULT_LAUNCH_MODE).toBe('thread');
  });

  it('inheritOptionLabel formats resolved values', () => {
    expect(inheritOptionLabel()).toBe('Use default');
    expect(inheritOptionLabel('MODERN')).toBe('Use default (Modern)');
    expect(inheritOptionLabel('CLI', 'Follow caller')).toBe('Follow caller (CLI Agent)');
    expect(inheritOptionLabel('Auto', 'Use {value} now')).toBe('Use Auto now');
    expect(inheritOptionLabel(undefined, 'Use default ({value})')).toBe('Use default');
  });

  it('squad.transport row matches resolver order', () => {
    expect(getSettingPrecedence('squad.transport').layers)
      .toEqual(['squad', 'launch', 'caller', 'global', 'launch-mode']);
    expect(precedenceHelp('squad.transport')).toContain('Per Squad, then Launch dialog selection, then Calling session, then All Squads, then Default launch mode');
  });
});
