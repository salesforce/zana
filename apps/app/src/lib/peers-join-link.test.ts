// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';


import { registerAppNavigate } from './app-navigate.js';
import {
  PEER_JOIN_PENDING_TTL_MS,
  buildPeerJoinLink,
  isPeerJoinDelivery,
  resetPeerJoinForTests,
  routeCoreDeepLink,
  subscribePeerJoin,
  takePendingPeerJoin
} from './peers-join-link.js';

const navigate = vi.fn();
const good = { route: 'peers/join', payload: 'tok-1' };

beforeEach(() => {
  resetPeerJoinForTests();
  navigate.mockReset();
  registerAppNavigate(navigate);
});
afterEach(() => {
  registerAppNavigate(null);
  delete (window as unknown as { cc?: unknown }).cc;
});

describe('isPeerJoinDelivery', () => {
  it('accepts only peers/join with a bounded clean payload', () => {
    expect(isPeerJoinDelivery(good)).toBe(true);
    for (const bad of [null, 'x', {}, { route: 'peers/other', payload: 'x' }, { route: 'peers/join' }, { route: 'peers/join', payload: '' }, { route: 'peers/join', payload: 'a'.repeat(4097) }, { route: 'peers/join', payload: 'a b' }]) {
      expect(isPeerJoinDelivery(bad)).toBe(false);
    }
  });
});

describe('routeCoreDeepLink', () => {
  it('parks the payload once and navigates to Settings → Peers', async () => {
    await expect(routeCoreDeepLink(good, 1000)).resolves.toBe('routed');
    expect(navigate).toHaveBeenCalledWith('/settings/peers', undefined);
    expect(takePendingPeerJoin(1001)).toBe('tok-1');
    expect(takePendingPeerJoin(1001)).toBeNull();
  });

  it('expires an unclaimed payload', async () => {
    await routeCoreDeepLink(good, 1000);
    expect(takePendingPeerJoin(1000 + PEER_JOIN_PENDING_TTL_MS + 1)).toBeNull();
  });

  it('notifies a mounted Peers view instead of parking', async () => {
    const listener = vi.fn();
    const off = subscribePeerJoin(listener);
    await routeCoreDeepLink(good);
    expect(listener).toHaveBeenCalledWith('tok-1');
    expect(takePendingPeerJoin()).toBeNull();
    off();
    await routeCoreDeepLink(good);
    expect(takePendingPeerJoin()).toBe('tok-1');
  });

  it('refuses invalid deliveries without parking or navigating', async () => {
    await expect(routeCoreDeepLink({ route: 'x', payload: 'y' })).resolves.toBe('invalid');
    expect(navigate).not.toHaveBeenCalled();
    expect(takePendingPeerJoin()).toBeNull();
  });
});

describe('buildPeerJoinLink', () => {
  const install = (config: () => Promise<unknown>) => { (window as unknown as { cc: unknown }).cc = { deepLinks: { config } }; };
  it('builds a base-relative link with an encoded token', async () => {
    install(async () => ({ base: 'zana://', acceptSchemes: [] }));
    await expect(buildPeerJoinLink('a+b/c')).resolves.toBe('zana://peers/join?d=a%2Bb%2Fc');
  });
  it('is null without a scheme, bridge, token, or on failure', async () => {
    await expect(buildPeerJoinLink('t')).resolves.toBeNull();
    install(async () => ({ base: null, acceptSchemes: [] }));
    await expect(buildPeerJoinLink('t')).resolves.toBeNull();
    await expect(buildPeerJoinLink('')).resolves.toBeNull();
    install(async () => { throw new Error('x'); });
    await expect(buildPeerJoinLink('t')).resolves.toBeNull();
  });
});
