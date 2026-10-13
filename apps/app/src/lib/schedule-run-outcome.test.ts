import { describe, expect, it } from 'vitest';
import type { ScheduledTask } from '@zana-ai/zcc-domain/product';
import { failedRunMessage } from './schedule-run-outcome';

const task = (runs: Array<{ result: string; message?: string }>) => ({ status: { runs } }) as unknown as ScheduledTask;

describe('failedRunMessage', () => {
  it('returns the newest run cause when it errored', () => {
    expect(failedRunMessage(task([{ result: 'error', message: ' no skill ' }, { result: 'success' }]))).toBe('no skill');
  });
  it('falls back when an errored run has no message', () => {
    expect(failedRunMessage(task([{ result: 'error' }]))).toContain('without a recorded cause');
  });
  it.each([[task([{ result: 'success' }])], [task([])], [undefined]])('is undefined when nothing failed', (t) => {
    expect(failedRunMessage(t)).toBeUndefined();
  });
  it('ignores an older failure behind a newer success', () => {
    expect(failedRunMessage(task([{ result: 'success' }, { result: 'error', message: 'old' }]))).toBeUndefined();
  });
});
