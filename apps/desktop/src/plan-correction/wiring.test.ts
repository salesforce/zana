import { describe, expect, it, vi } from 'vitest';
import { createExecutionRetiredCheck, createPlanCorrectionWarningLogger } from './wiring.js';

describe('createExecutionRetiredCheck', () => {
  const check = (record: { state: string; timeoutReason?: string } | undefined) =>
    createExecutionRetiredCheck(async () => record)('e1');

  it('retires a missing execution', async () => expect(await check(undefined)).toBe(true));
  it('retires a terminal, non-resumable execution', async () => {
    expect(await check({ state: 'COMPLETED' })).toBe(true);
    expect(await check({ state: 'STOPPED', timeoutReason: 'plan-correction-cancelled' })).toBe(true);
    expect(await check({ state: 'STOPPED', timeoutReason: 'unresolved-blocker' })).toBe(true);
  });
  it('keeps resumable and live executions', async () => {
    expect(await check({ state: 'STOPPED', timeoutReason: 'idle' })).toBe(false);
    expect(await check({ state: 'STOPPED' })).toBe(false);
    expect(await check({ state: 'RUNNING' })).toBe(false);
    expect(await check({ state: 'UNKNOWN' })).toBe(false);
  });
  it('propagates lookup failures (the store treats them as not retired)', async () => {
    await expect(createExecutionRetiredCheck(async () => { throw new Error('db'); })('e1')).rejects.toThrow('db');
  });
});

describe('createPlanCorrectionWarningLogger', () => {
  it('labels the host error log with the execution and message', () => {
    const logError = vi.fn();
    const error = new Error('x');
    createPlanCorrectionWarningLogger(logError)('e1', 'write-back failed', error);
    expect(logError).toHaveBeenCalledWith('planCorrection:e1: write-back failed', error);
  });
});
