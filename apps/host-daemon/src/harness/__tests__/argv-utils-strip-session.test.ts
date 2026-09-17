import { describe, expect, it } from 'vitest';
import { stripSessionResumeFlags } from '../argv-utils.js';

describe('stripSessionResumeFlags', () => {
  it('drops continue/resume/session flags so a restore can attach its own dialect', () => {
    expect(stripSessionResumeFlags(['--continue', '--model', 'opus', '--resume', 'old'])).toEqual([
      '--model',
      'opus'
    ]);
    expect(stripSessionResumeFlags(['--session', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'])).toBeUndefined();
    expect(stripSessionResumeFlags(['--session-id', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', '-c'])).toBeUndefined();
    expect(stripSessionResumeFlags(['--resume=old', '--thinking', 'high'])).toEqual(['--thinking', 'high']);
  });

  it('passes through empty extraArgs', () => {
    expect(stripSessionResumeFlags(undefined)).toBeUndefined();
    expect(stripSessionResumeFlags([])).toEqual([]);
  });
});
