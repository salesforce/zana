import type { ScheduledTask, ScheduleTemplate } from '@zana-ai/zcc-domain/product';

/** Seed values for a new-schedule page. May come from a template or a duplicate. */
export type ScheduleSeed =
  | { kind: 'template'; template: ScheduleTemplate }
  | { kind: 'duplicate'; source: ScheduledTask };

export function isScheduleSeed(value: unknown): value is ScheduleSeed {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    ((value as { kind: string }).kind === 'template' ||
      (value as { kind: string }).kind === 'duplicate')
  );
}

export function scheduleSeedFromLocationState(state: unknown): ScheduleSeed | null {
  if (!state || typeof state !== 'object' || !('seed' in state)) return null;
  const seed = (state as { seed?: unknown }).seed;
  return isScheduleSeed(seed) ? seed : null;
}
