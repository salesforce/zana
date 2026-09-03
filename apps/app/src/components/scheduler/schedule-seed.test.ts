import { describe, expect, it } from 'vitest';
import {
  isScheduleSeed,
  scheduleSeedFromLocationState
} from './schedule-seed.js';
import type { ScheduledTask, ScheduleTemplate } from '@zana-ai/zcc-domain/product';

const template = { name: 'Digest', source: 'builtin', defaults: {} } as ScheduleTemplate;
const task = { id: 's1', name: 'Morning' } as ScheduledTask;

describe('schedule seed', () => {
  it('recognizes template and duplicate seeds', () => {
    expect(isScheduleSeed({ kind: 'template', template })).toBe(true);
    expect(isScheduleSeed({ kind: 'duplicate', source: task })).toBe(true);
    expect(isScheduleSeed({ kind: 'other' })).toBe(false);
    expect(isScheduleSeed(null)).toBe(false);
  });

  it('reads a seed from location state', () => {
    expect(scheduleSeedFromLocationState({ seed: { kind: 'template', template } })).toEqual({
      kind: 'template',
      template
    });
    expect(scheduleSeedFromLocationState({ seed: { kind: 'nope' } })).toBeNull();
    expect(scheduleSeedFromLocationState(null)).toBeNull();
    expect(scheduleSeedFromLocationState('x')).toBeNull();
  });
});
