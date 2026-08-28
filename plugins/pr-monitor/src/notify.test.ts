import { describe, it, expect } from 'vitest';
import { computeNotifyDelivery } from '../lib/notify.js';
import type { MonitoredPr, MonitoredRepo, PrMonitorSettings } from '../lib/types.js';

/**
 * The R-NOTIF-002/003 + R-INBOX-002 delivery AND-chain (computeNotifyDelivery).
 * Two independent surfaces (in-app, inbox) over ONE shared mute scope.
 */

function repo(over: Partial<MonitoredRepo> = {}): MonitoredRepo {
  return {
    owner: 'acme',
    repo: 'widgets',
    host: 'github.com',
    orgLogin: 'acme',
    active: true,
    tisPreset: 'standard',
    createdAt: 0,
    notifyInApp: true,
    ...over,
  };
}

function pr(over: Partial<MonitoredPr> = {}): MonitoredPr {
  return { repo: 'acme/widgets', ...over } as MonitoredPr;
}

function settings(over: Partial<PrMonitorSettings> = {}): PrMonitorSettings {
  return {
    notifyInApp: true,
    sendToInbox: true,
    repositories: [repo()],
    ...over,
  } as PrMonitorSettings;
}

describe('computeNotifyDelivery — notification AND-chain', () => {
  it('AC-NOTIF-2.2: repo+global in-app on → in-app fires', () => {
    const d = computeNotifyDelivery(pr(), settings({ notifyInApp: true }));
    expect(d.inApp).toBe(true);
  });

  it('AC-NOTIF-2.3: global in-app off → no in-app for any PR (master switch)', () => {
    const d = computeNotifyDelivery(pr({ projectId: 'p1' }), settings({ notifyInApp: false }));
    expect(d.inApp).toBe(false);
    // ...but inbox is independent and still fires (AC-NOTIF-3.5).
    expect(d.inbox).toBe(true);
  });

  it('AC-REPO-11.4: per-repo notifyInApp:false mutes BOTH surfaces (shared scope)', () => {
    const d = computeNotifyDelivery(
      pr({ projectId: 'p1' }),
      settings({ repositories: [repo({ notifyInApp: false })] })
    );
    expect(d.inApp).toBe(false);
    expect(d.inbox).toBe(false);
  });

  it('AC-NOTIF-3.2: send-to-inbox on + project + worthy → inbox fires', () => {
    const d = computeNotifyDelivery(pr({ projectId: 'p1' }), settings({ sendToInbox: true }));
    expect(d.inbox).toBe(true);
  });

  it('AC-NOTIF-3.3: send-to-inbox off → no inbox for any PR (master switch)', () => {
    const d = computeNotifyDelivery(pr({ projectId: 'p1' }), settings({ sendToInbox: false }));
    expect(d.inbox).toBe(false);
  });

  it('AC-NOTIF-3.5: the two delivery flags are independent (inbox on, in-app off)', () => {
    const d = computeNotifyDelivery(
      pr({ projectId: 'p1' }),
      settings({ notifyInApp: false, sendToInbox: true })
    );
    expect(d.inApp).toBe(false);
    expect(d.inbox).toBe(true);
  });

  it('AC-NOTIF-3.5: independence the other way (in-app on, inbox off)', () => {
    const d = computeNotifyDelivery(
      pr({ projectId: 'p1' }),
      settings({ notifyInApp: true, sendToInbox: false })
    );
    expect(d.inApp).toBe(true);
    expect(d.inbox).toBe(false);
  });

  it('AC-NOTIF-3.6 / AC-LIST-18.1: a muted PR is silenced on BOTH surfaces', () => {
    const d = computeNotifyDelivery(
      pr({ projectId: 'p1', muted: true }),
      settings({ notifyInApp: true, sendToInbox: true })
    );
    expect(d.inApp).toBe(false);
    expect(d.inbox).toBe(false);
  });

  it('AC-INBOX-2.3: inbox requires a Project association', () => {
    const d = computeNotifyDelivery(
      pr({ projectId: undefined }),
      settings({ sendToInbox: true })
    );
    expect(d.inbox).toBe(false);
    // in-app has no project constraint.
    expect(d.inApp).toBe(true);
  });

  it('AC-LIST-18.5: per-PR mute is the finest link — even repo+globals on', () => {
    const d = computeNotifyDelivery(
      pr({ projectId: 'p1', muted: true }),
      settings()
    );
    expect(d).toEqual({ inApp: false, inbox: false });
  });

  it('falls back to legacy notifyOnChange when notifyInApp is absent', () => {
    const s = {
      notifyOnChange: true,
      sendToInbox: false,
      repositories: [repo()],
    } as PrMonitorSettings;
    const d = computeNotifyDelivery(pr({ projectId: 'p1' }), s);
    expect(d.inApp).toBe(true);
  });

  it('unknown repo record does not mute (narrowing flag, not a gate)', () => {
    const d = computeNotifyDelivery(
      pr({ repo: 'other/repo', projectId: 'p1' }),
      settings({ repositories: [] })
    );
    expect(d.inApp).toBe(true);
    expect(d.inbox).toBe(true);
  });
});
