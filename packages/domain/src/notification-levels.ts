/**
 * Per-thread notification levels (ported from BB's push-notifications plugin).
 *
 * A thread has an OWN level (`inherit` when unset). The effective level is the
 * own level, else the child default for a thread with a parent, else the global
 * default; the quietest own level among its ancestors then caps it, so muting a
 * parent quiets everything it spawned. Pure so the server (gating) and the
 * renderer (labels) share one definition.
 */

export const NOTIFICATION_LEVELS = ['all', 'input-only', 'muted'] as const;
export type NotificationLevel = (typeof NOTIFICATION_LEVELS)[number];

export const OWN_NOTIFICATION_LEVELS = ['inherit', ...NOTIFICATION_LEVELS] as const;
export type OwnNotificationLevel = (typeof OWN_NOTIFICATION_LEVELS)[number];

export type NotificationSource = 'self' | 'parent' | 'ancestor' | 'global' | 'child-default';

/** What happened on a thread that may deserve a push. */
export const PUSH_NOTIFICATION_KINDS = ['pending-interaction', 'thread-error', 'turn-finished'] as const;
export type PushNotificationKind = (typeof PUSH_NOTIFICATION_KINDS)[number];

export function isPushNotificationKind(value: unknown): value is PushNotificationKind {
  return typeof value === 'string' && (PUSH_NOTIFICATION_KINDS as readonly string[]).includes(value);
}

export interface NotificationDefaults {
  /** For threads with no own level. */
  defaultLevel: NotificationLevel;
  /** For child threads with no own level; `inherit` falls back to `defaultLevel`. */
  childLevel: OwnNotificationLevel;
}

export const DEFAULT_NOTIFICATION_DEFAULTS: NotificationDefaults = {
  defaultLevel: 'all',
  childLevel: 'input-only'
};

export const NOTIFICATION_LEVEL_LABELS: Record<OwnNotificationLevel, string> = {
  inherit: 'Default',
  all: 'All activity',
  'input-only': 'Needs input only',
  muted: 'Muted'
};

/** Input-only still tells you about a failure: a failed thread needs the user too. */
export const NOTIFICATION_KINDS_BY_LEVEL: Record<NotificationLevel, ReadonlySet<PushNotificationKind>> = {
  all: new Set<PushNotificationKind>(['pending-interaction', 'thread-error', 'turn-finished']),
  'input-only': new Set<PushNotificationKind>(['pending-interaction', 'thread-error']),
  muted: new Set<PushNotificationKind>()
};

const LEVEL_RANK: Record<NotificationLevel, number> = { muted: 0, 'input-only': 1, all: 2 };

export function isNotificationLevel(value: unknown): value is NotificationLevel {
  return typeof value === 'string' && (NOTIFICATION_LEVELS as readonly string[]).includes(value);
}

export function isOwnNotificationLevel(value: unknown): value is OwnNotificationLevel {
  return typeof value === 'string' && (OWN_NOTIFICATION_LEVELS as readonly string[]).includes(value);
}

export function levelAllowsKind(level: NotificationLevel, kind: PushNotificationKind): boolean {
  return NOTIFICATION_KINDS_BY_LEVEL[level].has(kind);
}

export interface NotificationAncestorCap {
  level: NotificationLevel;
  threadId: string;
}

export interface ThreadNotificationInputs {
  own: OwnNotificationLevel;
  ancestorCap: NotificationAncestorCap | null;
}

export interface ThreadNotifications {
  own: OwnNotificationLevel;
  effective: NotificationLevel;
  source: NotificationSource;
}

/** What the API reports for one thread: its resolved level plus the defaults behind it. */
export interface ThreadNotificationState extends ThreadNotifications, NotificationDefaults {
  threadId: string;
}

/**
 * Quietest own level among `ancestors` (nearest first). Ties keep the nearest
 * ancestor so the source reads "parent" whenever the parent is as quiet as any.
 */
export function quietestAncestorCap(
  ancestors: ReadonlyArray<{ threadId: string; own: OwnNotificationLevel | undefined }>
): NotificationAncestorCap | null {
  let cap: NotificationAncestorCap | null = null;
  for (const ancestor of ancestors) {
    if (!isNotificationLevel(ancestor.own)) continue;
    if (cap === null || LEVEL_RANK[ancestor.own] < LEVEL_RANK[cap.level]) {
      cap = { level: ancestor.own, threadId: ancestor.threadId };
    }
  }
  return cap;
}

export function resolveThreadNotifications(
  stored: ThreadNotificationInputs,
  thread: { parentThreadId: string | null },
  defaults: NotificationDefaults
): ThreadNotifications {
  const { own, ancestorCap } = stored;
  const base: { level: NotificationLevel; source: NotificationSource } =
    own !== 'inherit'
      ? { level: own, source: 'self' }
      : thread.parentThreadId !== null && defaults.childLevel !== 'inherit'
        ? { level: defaults.childLevel, source: 'child-default' }
        : { level: defaults.defaultLevel, source: 'global' };
  if (ancestorCap === null || LEVEL_RANK[ancestorCap.level] >= LEVEL_RANK[base.level]) {
    return { own, effective: base.level, source: base.source };
  }
  return {
    own,
    effective: ancestorCap.level,
    source: ancestorCap.threadId === thread.parentThreadId ? 'parent' : 'ancestor'
  };
}

/** Validate the two stored defaults; anything unrecognised falls back to the shipped default. */
export function normalizeNotificationDefaults(input: {
  notificationDefaultLevel?: unknown;
  notificationChildLevel?: unknown;
}): NotificationDefaults {
  return {
    defaultLevel: isNotificationLevel(input.notificationDefaultLevel)
      ? input.notificationDefaultLevel
      : DEFAULT_NOTIFICATION_DEFAULTS.defaultLevel,
    childLevel: isOwnNotificationLevel(input.notificationChildLevel)
      ? input.notificationChildLevel
      : DEFAULT_NOTIFICATION_DEFAULTS.childLevel
  };
}

export function describeNotificationSource(source: NotificationSource): string {
  switch (source) {
    case 'self':
      return 'set on this thread';
    case 'parent':
      return 'limited by the parent thread';
    case 'ancestor':
      return 'limited by an ancestor thread';
    case 'child-default':
      return 'child-thread default';
    default:
      return 'default';
  }
}
