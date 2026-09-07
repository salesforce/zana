import { describe, expect, it } from 'vitest';
import {
  EMPTY_HOST_INSTALL_DRAWER,
  HOST_INSTALL_LOG_CAP,
  hostInstallDrawerShouldAutoClose,
  hostInstallDrawerTitle,
  reduceHostInstallAppend,
  reduceHostInstallEvent,
  reduceHostInstallFinish,
  reduceHostInstallOpen,
  splitHostInstallLogText
} from '../host-install-drawer.js';

describe('host install drawer reducers', () => {
  it('opens a busy panel and titles it from kind', () => {
    const open = reduceHostInstallOpen(EMPTY_HOST_INSTALL_DRAWER, {
      kind: 'install',
      target: 'limited-pony'
    });
    expect(open).toMatchObject({
      open: true,
      busy: true,
      kind: 'install',
      target: 'limited-pony',
      logs: [],
      error: null
    });
    expect(hostInstallDrawerTitle(open)).toBe('Installing…');
    expect(hostInstallDrawerTitle({ busy: true, kind: 'fix', error: null })).toBe('Reconnecting…');
  });

  it('appends log events and keeps the latest cap', () => {
    const open = reduceHostInstallOpen(EMPTY_HOST_INSTALL_DRAWER, { kind: 'install', target: 'box' });
    const withLog = reduceHostInstallEvent(open, {
      type: 'log',
      text: 'Installing host daemon over SSH…\nhost daemon did not report connected'
    });
    expect(withLog.logs).toEqual([
      'Installing host daemon over SSH…',
      'host daemon did not report connected'
    ]);
    const overflow = reduceHostInstallAppend(withLog, Array.from({ length: HOST_INSTALL_LOG_CAP }, (_, i) => `l${i}`));
    expect(overflow.logs).toHaveLength(HOST_INSTALL_LOG_CAP);
    expect(overflow.logs[0]).toBe('l0');
  });

  it('finishes with a short error and pairing command', () => {
    const open = reduceHostInstallOpen(EMPTY_HOST_INSTALL_DRAWER, { kind: 'install', target: 'box' });
    const failed = reduceHostInstallFinish(open, {
      ok: false,
      message: 'The host daemon started but never connected back.',
      pairingCommand: 'ssh -R …'
    });
    expect(failed.busy).toBe(false);
    expect(failed.open).toBe(true);
    expect(failed.error).toContain('never connected back');
    expect(failed.pairingCommand).toContain('ssh -R');
    expect(hostInstallDrawerTitle(failed)).toBe('Install failed');
    expect(hostInstallDrawerShouldAutoClose(failed)).toBe(false);
  });

  it('keeps a successful reconnect open until the drawer auto-closes', () => {
    const open = reduceHostInstallOpen(EMPTY_HOST_INSTALL_DRAWER, { kind: 'fix', target: 'limited-pony' });
    const done = reduceHostInstallFinish(open, { ok: true });
    expect(done).toMatchObject({ open: true, busy: false, error: null });
    expect(hostInstallDrawerTitle(done)).toBe('Reconnected');
    expect(hostInstallDrawerShouldAutoClose(done)).toBe(true);
    expect(hostInstallDrawerShouldAutoClose({ open: true, busy: true, error: null })).toBe(false);
    expect(hostInstallDrawerShouldAutoClose({ open: false, busy: false, error: null })).toBe(false);
  });

  it('splits blank lines out of a dump', () => {
    expect(splitHostInstallLogText('a\n\n  b  \n')).toEqual(['a', '  b']);
  });
});
