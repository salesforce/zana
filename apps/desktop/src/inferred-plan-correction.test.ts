import { describe, expect, it, vi } from 'vitest';
import { INFERRED_PLAN_NUDGE_BUDGET, createInferredPlanCorrection } from './inferred-plan-correction.js';

const ctx = (executionId: string) => ({ sessionId: 's', projectId: 'p', projectRoot: '/r', executionId, slotId: 'o' });

function setup(records: Set<string> = new Set()) {
  const reviewInvalid = vi.fn(async (c: ReturnType<typeof ctx>) => (records.has(c.executionId) ? 'wait' as const : undefined));
  const begin = vi.fn(async (executionId: string) => { records.add(executionId); });
  return { reviewInvalid, begin, escalator: createInferredPlanCorrection({ reviewInvalid, begin }) };
}

describe('createInferredPlanCorrection', () => {
  it('passes through to nudges within the budget, then opens a correction record and re-reviews', async () => {
    const { escalator, begin, reviewInvalid } = setup();
    for (let i = 0; i < INFERRED_PLAN_NUDGE_BUDGET; i += 1) {
      await expect(escalator.reviewInvalid(ctx('e1'), 'bad')).resolves.toBeUndefined();
    }
    expect(begin).not.toHaveBeenCalled();
    await expect(escalator.reviewInvalid(ctx('e1'), 'still bad')).resolves.toBe('wait');
    expect(begin).toHaveBeenCalledWith('e1', 'still bad', false);
    expect(reviewInvalid).toHaveBeenCalledTimes(INFERRED_PLAN_NUDGE_BUDGET + 2);
  });

  it('defers to an existing record (provided plans) without counting or beginning', async () => {
    const { escalator, begin } = setup(new Set(['e1']));
    for (let i = 0; i < 5; i += 1) await expect(escalator.reviewInvalid(ctx('e1'), 'bad')).resolves.toBe('wait');
    expect(begin).not.toHaveBeenCalled();
  });

  it('tracks executions independently and forget resets the count', async () => {
    const { escalator, begin } = setup();
    for (let i = 0; i < INFERRED_PLAN_NUDGE_BUDGET; i += 1) await escalator.reviewInvalid(ctx('a'), 'x');
    await escalator.reviewInvalid(ctx('b'), 'x');
    escalator.forget('a');
    await escalator.reviewInvalid(ctx('a'), 'x');
    expect(begin).not.toHaveBeenCalled();
  });

  it('honors a custom nudge budget and bounds tracked executions', async () => {
    const records = new Set<string>();
    const reviewInvalid = vi.fn(async (c: ReturnType<typeof ctx>) => (records.has(c.executionId) ? 'wait' as const : undefined));
    const begin = vi.fn(async (id: string) => { records.add(id); });
    const escalator = createInferredPlanCorrection({ reviewInvalid, begin, nudgeBudget: 0 });
    await expect(escalator.reviewInvalid(ctx('z'), 'r')).resolves.toBe('wait');
    expect(begin).toHaveBeenCalledTimes(1);

    const bounded = createInferredPlanCorrection({ reviewInvalid: async () => undefined, begin: async () => {} });
    for (let i = 0; i < 300; i += 1) await bounded.reviewInvalid(ctx(`e${i}`), 'r');
    // e0 was evicted, so it has a fresh budget again rather than escalating.
    await bounded.reviewInvalid(ctx('e0'), 'r');
    await expect(bounded.reviewInvalid(ctx('e0'), 'r')).resolves.toBeUndefined();
  });
});
