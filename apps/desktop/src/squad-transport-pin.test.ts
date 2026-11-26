import { describe, expect, it } from 'vitest';
import { TransportPins, pinTeamTransport, resolveTeamTransport, toPinned } from './squad-transport-pin.js';

const team = (transport?: 'CLI' | 'MODERN' | 'CALLER') => ({ id: 't', ...(transport ? { transport } : {}) }) as never;
const config = { squadDefaultTransport: 'caller' as const, composerDefaultLaunchMode: 'thread' as const, composerLastTransportMode: undefined };

describe('TransportPins', () => {
  it('stores, replaces, and ignores empty keys', () => {
    const pins = new TransportPins();
    expect(pins.get(undefined)).toBeUndefined();
    pins.set('a', { transport: 'CLI', source: 'squad' });
    pins.set('a', { transport: 'MODERN', source: 'caller' });
    expect(pins.get('a')?.transport).toBe('MODERN');
  });

  it('evicts oldest past the cap', () => {
    const pins = new TransportPins();
    for (let i = 0; i < 300; i += 1) pins.set(`k${i}`, { transport: 'CLI', source: 'global' });
    expect(pins.get('k0')).toBeUndefined();
    expect(pins.get('k299')).toBeDefined();
  });
});

describe('resolveTeamTransport', () => {
  it('honors a Squad pin', () => {
    const r = resolveTeamTransport({ team: team('MODERN'), config, project: {} });
    expect(r).toMatchObject({ ok: true, transport: 'MODERN', source: 'squad' });
  });

  it('refuses an explicit Modern pin on a remote project', () => {
    const r = resolveTeamTransport({ team: team('MODERN'), config, project: { remote: {} } });
    expect(r.ok).toBe(false);
  });

  it('follows the caller when Use default and global is caller', () => {
    const r = resolveTeamTransport({ team: team(), config, project: {}, callerTransport: 'MODERN', source: 'agent' });
    expect(r).toMatchObject({ ok: true, transport: 'MODERN', source: 'caller' });
  });

  it('falls back to CLI when inherited Modern is blocked', () => {
    const r = resolveTeamTransport({ team: team(), config, project: { remote: {} }, callerTransport: 'MODERN', source: 'agent' });
    expect(r).toMatchObject({ ok: true, transport: 'CLI' });
    expect(toPinned(r)?.fallbackReason).toBeTruthy();
  });

  it('seat-bearing Squad: inherited Modern falls back to CLI; explicit Modern pin or pick is left to the launch path refusal', () => {
    const seats = { slots: [{ startOnDemand: true }] };
    const modernCfg = { ...config, squadDefaultTransport: 'MODERN' as const };
    const inherited = resolveTeamTransport({ team: seats, config: modernCfg, project: {}, source: 'ui' });
    expect(inherited).toMatchObject({ ok: true, transport: 'CLI', source: 'fallback-squad-mode' });
    expect(resolveTeamTransport({ team: { ...seats, transport: 'MODERN' }, config: modernCfg, project: {}, source: 'ui' }))
      .toMatchObject({ ok: true, transport: 'MODERN', source: 'squad' });
    expect(resolveTeamTransport({ team: seats, config: modernCfg, project: {}, source: 'ui', pick: 'MODERN' }))
      .toMatchObject({ ok: true, transport: 'MODERN', source: 'launch-picker' });
  });
});

describe('pin helpers', () => {
  it('writes the resolved transport into a copy', () => {
    const original = team('CALLER');
    const pinned = pinTeamTransport(original, { transport: 'CLI', source: 'caller' });
    expect(pinned.transport).toBe('CLI');
    expect((original as { transport: string }).transport).toBe('CALLER');
  });

  it('toPinned drops refusals', () => {
    expect(toPinned({ ok: false, source: 'squad', refusal: 'no' } as never)).toBeUndefined();
  });
});
