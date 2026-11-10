import { describe, expect, it } from 'vitest';
import { answerReceipt } from '../answer-receipt.js';

const record = { id: 'execution-1', state: 'RUNNING', workUnits: [{ id: 'u', result: 'secret' }] };

describe('answerReceipt (#691)', () => {
  it('builds the D1 receipt and nothing else', () => {
    const receipt = answerReceipt({ ok: true, pending: true, notified: true, resumeRequested: true, delivery: { id: 'd1' }, value: record }, 'b1');
    expect(receipt).toEqual({ ok: true, executionId: 'execution-1', blockerId: 'b1', deliveryId: 'd1', pending: true, notified: true, resumeRequested: true, state: 'RUNNING' });
  });

  it('defaults missing flags to false and a missing delivery to null', () => {
    expect(answerReceipt({ ok: true, value: record }, 'b1')).toEqual({ ok: true, executionId: 'execution-1', blockerId: 'b1', deliveryId: null, pending: false, notified: false, resumeRequested: false, state: 'RUNNING' });
  });

  it.each([
    ['a failed result', { ok: false, value: record }],
    ['no value', { ok: true }],
    ['a non-object value', { ok: true, value: 'text' }],
    ['a value without an id', { ok: true, value: { state: 'RUNNING' } }]
  ])('returns undefined for %s so the caller keeps the existing reply', (_label, result) => {
    expect(answerReceipt(result as never, 'b1')).toBeUndefined();
  });
});
