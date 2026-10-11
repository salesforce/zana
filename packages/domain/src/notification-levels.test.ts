import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTIFICATION_DEFAULTS,
  NOTIFICATION_KINDS_BY_LEVEL,
  describeNotificationSource,
  isNotificationLevel,
  isOwnNotificationLevel,
  isPushNotificationKind,
  levelAllowsKind,
  normalizeNotificationDefaults,
  quietestAncestorCap,
  resolveThreadNotifications,
  type NotificationDefaults,
  type PushNotificationKind
} from './notification-levels.js';

const KINDS: PushNotificationKind[] = ['pending-interaction', 'thread-error', 'turn-finished'];
const defaults: NotificationDefaults = { defaultLevel: 'all', childLevel: 'input-only' };

describe('notification level guards', () => {
  it('accepts only the documented values', () => {
    expect(['all', 'input-only', 'muted'].every(isNotificationLevel)).toBe(true);
    expect(isNotificationLevel('inherit')).toBe(false);
    expect(isNotificationLevel('loud')).toBe(false);
    expect(isNotificationLevel(undefined)).toBe(false);
    expect(['inherit', 'all', 'input-only', 'muted'].every(isOwnNotificationLevel)).toBe(true);
    expect(isOwnNotificationLevel('quiet')).toBe(false);
    expect(isOwnNotificationLevel(7)).toBe(false);
  });
});

describe('isPushNotificationKind', () => {
  it('accepts the three kinds only', () => {
    expect(KINDS.every(isPushNotificationKind)).toBe(true);
    expect(isPushNotificationKind('shout')).toBe(false);
    expect(isPushNotificationKind(null)).toBe(false);
  });
});

describe('levelAllowsKind', () => {
  it('sends everything on all, only attention kinds on input-only and nothing when muted', () => {
    expect(KINDS.map((kind) => levelAllowsKind('all', kind))).toEqual([true, true, true]);
    expect(KINDS.map((kind) => levelAllowsKind('input-only', kind))).toEqual([true, true, false]);
    expect(KINDS.map((kind) => levelAllowsKind('muted', kind))).toEqual([false, false, false]);
    expect(NOTIFICATION_KINDS_BY_LEVEL.muted.size).toBe(0);
  });
});

describe('resolveThreadNotifications', () => {
  it('uses the global default for a top-level thread with no own level', () => {
    expect(
      resolveThreadNotifications({ own: 'inherit', ancestorCap: null }, { parentThreadId: null }, defaults)
    ).toEqual({ own: 'inherit', effective: 'all', source: 'global' });
  });

  it('uses the child default for a thread with a parent', () => {
    expect(
      resolveThreadNotifications({ own: 'inherit', ancestorCap: null }, { parentThreadId: 'p' }, defaults)
    ).toEqual({ own: 'inherit', effective: 'input-only', source: 'child-default' });
  });

  it('falls back to the global default when the child default is inherit', () => {
    expect(
      resolveThreadNotifications(
        { own: 'inherit', ancestorCap: null },
        { parentThreadId: 'p' },
        { defaultLevel: 'muted', childLevel: 'inherit' }
      )
    ).toEqual({ own: 'inherit', effective: 'muted', source: 'global' });
  });

  it('lets an own level beat both defaults', () => {
    expect(
      resolveThreadNotifications({ own: 'all', ancestorCap: null }, { parentThreadId: 'p' }, defaults)
    ).toEqual({ own: 'all', effective: 'all', source: 'self' });
    expect(
      resolveThreadNotifications(
        { own: 'muted', ancestorCap: null },
        { parentThreadId: null },
        defaults
      )
    ).toEqual({ own: 'muted', effective: 'muted', source: 'self' });
  });

  it('caps a child by a quieter parent and labels the source parent', () => {
    expect(
      resolveThreadNotifications(
        { own: 'all', ancestorCap: { level: 'muted', threadId: 'p' } },
        { parentThreadId: 'p' },
        defaults
      )
    ).toEqual({ own: 'all', effective: 'muted', source: 'parent' });
  });

  it('labels a cap from a more distant thread as ancestor', () => {
    expect(
      resolveThreadNotifications(
        { own: 'inherit', ancestorCap: { level: 'muted', threadId: 'grandparent' } },
        { parentThreadId: 'p' },
        { defaultLevel: 'all', childLevel: 'all' }
      )
    ).toEqual({ own: 'inherit', effective: 'muted', source: 'ancestor' });
  });

  it('never lets an ancestor cap make a thread louder', () => {
    expect(
      resolveThreadNotifications(
        { own: 'muted', ancestorCap: { level: 'all', threadId: 'p' } },
        { parentThreadId: 'p' },
        defaults
      )
    ).toEqual({ own: 'muted', effective: 'muted', source: 'self' });
    expect(
      resolveThreadNotifications(
        { own: 'inherit', ancestorCap: { level: 'input-only', threadId: 'p' } },
        { parentThreadId: 'p' },
        { defaultLevel: 'all', childLevel: 'input-only' }
      )
    ).toEqual({ own: 'inherit', effective: 'input-only', source: 'child-default' });
  });
});

describe('quietestAncestorCap', () => {
  it('returns null without any ancestor setting', () => {
    expect(quietestAncestorCap([])).toBeNull();
    expect(
      quietestAncestorCap([
        { threadId: 'a', own: undefined },
        { threadId: 'b', own: 'inherit' }
      ])
    ).toBeNull();
  });

  it('picks the quietest own level, preferring the nearest ancestor on ties', () => {
    expect(
      quietestAncestorCap([
        { threadId: 'near', own: 'input-only' },
        { threadId: 'mid', own: 'all' },
        { threadId: 'far', own: 'muted' }
      ])
    ).toEqual({ level: 'muted', threadId: 'far' });
    expect(
      quietestAncestorCap([
        { threadId: 'near', own: 'muted' },
        { threadId: 'far', own: 'muted' }
      ])
    ).toEqual({ level: 'muted', threadId: 'near' });
  });
});

describe('normalizeNotificationDefaults', () => {
  it('returns the documented defaults for missing or invalid values', () => {
    expect(normalizeNotificationDefaults({})).toEqual(DEFAULT_NOTIFICATION_DEFAULTS);
    expect(DEFAULT_NOTIFICATION_DEFAULTS).toEqual({ defaultLevel: 'all', childLevel: 'input-only' });
    expect(
      normalizeNotificationDefaults({ notificationDefaultLevel: 'inherit', notificationChildLevel: 'bogus' })
    ).toEqual(DEFAULT_NOTIFICATION_DEFAULTS);
  });

  it('keeps valid values and allows inherit only for the child level', () => {
    expect(
      normalizeNotificationDefaults({ notificationDefaultLevel: 'muted', notificationChildLevel: 'inherit' })
    ).toEqual({ defaultLevel: 'muted', childLevel: 'inherit' });
  });
});

describe('describeNotificationSource', () => {
  it('describes every source in plain words', () => {
    expect(describeNotificationSource('self')).toBe('set on this thread');
    expect(describeNotificationSource('parent')).toBe('limited by the parent thread');
    expect(describeNotificationSource('ancestor')).toBe('limited by an ancestor thread');
    expect(describeNotificationSource('child-default')).toBe('child-thread default');
    expect(describeNotificationSource('global')).toBe('default');
  });
});
