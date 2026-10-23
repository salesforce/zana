import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchDigest } from '@zana-ai/zcc-server/services/launch/digest';
import { COORDINATOR_WAKE_MESSAGE_MAX, PLAN_CORRECTION_HELD_MESSAGE, PLAN_CORRECTION_MAX_RETRIES, PLAN_CORRECTION_STALL_IDLE_EDGES, PlanCorrectionService, runPlanCorrectionHostAction } from './service.js';

const ctx = { sessionId: 's-1', projectId: 'p-1', projectRoot: '/root', executionId: 'e-1', slotId: 'lead' };
const source = { status: 'ok' as const, units: [{ id: 'source', title: 'Source', task: 'source', dependencies: [] }], realPath: '/root/.zana/source.md' };

function create() {
  const appendInbox = vi.fn(async (input) => ({ ...input, id: 'i-1', ts: 1 }));
  const bindInboxAction = vi.fn(() => true);
  const nudge = vi.fn();
  const wakeCoordinator = vi.fn(async () => {});
  const readCorrectedPlan = vi.fn(async () => source);
  const records = new Map();
  const store = {
    get: vi.fn(async (executionId: string) => { const found = records.get(executionId); return found ? structuredClone(found) : undefined; }),
    listCancelled: vi.fn(async () => [...records.values()].filter((record) => record.status === 'cancelled')),
    put: vi.fn(async (record) => {
      const existing = records.get(record.executionId);
      if (existing?.status === 'cancelled' && record.status !== 'cancelled') return structuredClone(existing);
      records.set(record.executionId, structuredClone(record));
      return record;
    })
  };
  const resume = vi.fn(async () => {});
  const stopExecution = vi.fn(async () => {});
  const updateScheduledPrompt = vi.fn(async () => {});
  const readSourcePlan = vi.fn(async (): Promise<string | undefined> => '### write: Write output <!-- executable-step -->');
  return {
    service: new PlanCorrectionService({ appendInbox, bindInboxAction, nudge, wakeCoordinator, readSourcePlan, readCorrectedPlan, store, updateScheduledPrompt, resume, stopExecution }),
    appendInbox, bindInboxAction, nudge, wakeCoordinator, readSourcePlan, readCorrectedPlan, updateScheduledPrompt, resume, stopExecution, records, store
  };
}

it('updates a scheduled prompt before resuming its approved corrected plan', async () => {
  const { service, bindInboxAction, updateScheduledPrompt, resume } = create();
  const scheduled = { ...ctx, executionId: 'e-scheduled' };
  await service.begin(scheduled.executionId, 'invalid source plan', false);
  await service.review(scheduled, source);

  await expect(service.respond(scheduled.executionId, 'approve', latestOffer(bindInboxAction))).resolves.toBe('approve');

  expect(updateScheduledPrompt).toHaveBeenCalledWith(scheduled, source.units);
  expect(resume).toHaveBeenCalledWith(scheduled);
});

it('does not resume when scheduled prompt persistence fails', async () => {
  const { service, bindInboxAction, updateScheduledPrompt, resume } = create();
  updateScheduledPrompt.mockRejectedValueOnce(new Error('schedule disappeared'));
  await service.begin(ctx.executionId, 'invalid source plan', false);
  await service.review(ctx, source);

  await expect(service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction))).resolves.toBe('reject');

  expect(resume).not.toHaveBeenCalled();
});

it('re-approves after the approved-state persist throws once (write-back already applied)', async () => {
  const { service, bindInboxAction, store, updateScheduledPrompt, resume } = create();
  await service.begin(ctx.executionId, 'invalid source plan', false);
  await service.review(ctx, source);
  store.put.mockRejectedValueOnce(new Error('disk full'));

  await expect(service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction))).rejects.toThrow('disk full');
  expect(resume).not.toHaveBeenCalled();

  await expect(service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction))).resolves.toBe('approve');
  expect(updateScheduledPrompt).toHaveBeenCalledTimes(2);
  expect(resume).toHaveBeenCalledOnce();
});

it('surfaces a definition edit conflict as a user-visible rejection reason and logs the write-back failure', async () => {
  const { service, bindInboxAction, updateScheduledPrompt, resume } = create();
  const logWarning = vi.fn();
  (service as unknown as { deps: { logWarning: typeof logWarning } }).deps.logWarning = logWarning;
  const conflict = Object.assign(new Error('schedule s-1 prompt was edited since this run launched'), { code: 'DEFINITION_CONFLICT' });
  updateScheduledPrompt.mockRejectedValueOnce(conflict);
  await service.begin(ctx.executionId, 'invalid source plan', false);
  await service.review(ctx, source);
  const offer = latestOffer(bindInboxAction);

  await expect(runPlanCorrectionHostAction(service, JSON.stringify(offer), 'approve'))
    .rejects.toThrow('rejected or superseded: schedule s-1 prompt was edited since this run launched');
  expect(logWarning).toHaveBeenCalledWith(ctx.executionId, expect.stringContaining('write-back failed'), conflict);
  expect(resume).not.toHaveBeenCalled();
});

it('uses a generic message for a conflict-shaped value that is not an Error', async () => {
  const { service, bindInboxAction, updateScheduledPrompt } = create();
  updateScheduledPrompt.mockRejectedValueOnce({ code: 'DEFINITION_CONFLICT' });
  await service.begin(ctx.executionId, 'invalid source plan', false);
  await service.review(ctx, source);
  await expect(runPlanCorrectionHostAction(service, JSON.stringify(latestOffer(bindInboxAction)), 'approve'))
    .rejects.toThrow('edited since this run launched');
});

it('keeps incidental write-back failures generic', async () => {
  const { service, bindInboxAction, updateScheduledPrompt } = create();
  updateScheduledPrompt.mockRejectedValueOnce(new Error('EACCES /secret/path'));
  await service.begin(ctx.executionId, 'invalid source plan', false);
  await service.review(ctx, source);
  await expect(runPlanCorrectionHostAction(service, JSON.stringify(latestOffer(bindInboxAction)), 'approve'))
    .rejects.toThrow(/^plan correction action was rejected or superseded$/);
});

it('persists the request-changes state before nudging the coordinator', async () => {
  const { service, bindInboxAction, store, wakeCoordinator } = create();
  await service.begin(ctx.executionId, 'bad plan', false);
  await service.review(ctx, source);
  const order: string[] = [];
  const put = store.put.getMockImplementation()!;
  store.put.mockImplementation(async (record) => { order.push('put'); return put(record); });
  wakeCoordinator.mockImplementation(async () => { order.push('nudge'); });

  await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));

  expect(order).toEqual(['put', 'nudge']);
});

it('does not nudge when the request-changes persist loses to a cancellation', async () => {
  const { service, bindInboxAction, store, wakeCoordinator, stopExecution } = create();
  await service.begin(ctx.executionId, 'bad plan', false);
  await service.review(ctx, source);
  store.put.mockResolvedValueOnce({ status: 'cancelled' } as never);

  await expect(service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction))).resolves.toBe('reject');
  expect(wakeCoordinator).not.toHaveBeenCalled();
  expect(stopExecution).toHaveBeenCalled();
});

it('logs an unreadable source plan and still instructs the coordinator', async () => {
  const { service, bindInboxAction, readSourcePlan, wakeCoordinator } = create();
  const logWarning = vi.fn();
  (service as unknown as { deps: { logWarning: typeof logWarning } }).deps.logWarning = logWarning;
  const failure = new Error('ENOENT');
  readSourcePlan.mockRejectedValueOnce(failure);
  await service.begin(ctx.executionId, 'bad plan', false);
  await service.review(ctx, source);

  await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));

  expect(logWarning).toHaveBeenCalledWith(ctx.executionId, expect.stringContaining('supplied plan'), failure);
  expect(wakeCoordinator).toHaveBeenCalled();
});

it('forgets published offer ids once the offer is consumed or superseded', async () => {
  const { service, bindInboxAction, readCorrectedPlan } = create();
  const published = () => (service as unknown as { publishedOfferIds: Set<string> }).publishedOfferIds;
  await service.begin(ctx.executionId, 'bad plan', false);
  await service.review(ctx, source);
  const first = latestOffer(bindInboxAction);
  expect(published().has(first.offerId)).toBe(true);

  // A rejected response leaves the live offer published.
  await expect(service.respond(ctx.executionId, 'approve', { ...first, digest: 'stale' })).resolves.toBe('reject');
  expect(published().has(first.offerId)).toBe(true);

  await service.respond(ctx.executionId, 'changes', first);
  expect(published().size).toBe(0);

  // A new request supersedes the previous offer id.
  readCorrectedPlan.mockResolvedValue({ ...source, units: [{ ...source.units[0], task: 'v2' }] });
  await service.review(ctx, source);
  const second = latestOffer(bindInboxAction);
  expect(published()).toEqual(new Set([second.offerId]));
  await service.respond(ctx.executionId, 'cancel', second);
  expect(published().size).toBe(0);
});

function latestOffer(bindInboxAction: ReturnType<typeof vi.fn>) {
  return JSON.parse(bindInboxAction.mock.calls.at(-1)![1].ref);
}

describe('PlanCorrectionService', () => {
  it('holds source plan until inbox approval, then returns corrected plan', async () => {
    const { service, appendInbox, bindInboxAction, nudge } = create();
    await service.begin(ctx.executionId, 'missing verification', false);
    expect(await service.review(ctx, source)).toBe('wait');
    expect(appendInbox).toHaveBeenCalledOnce();
    await expect(service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction))).resolves.toBe('approve');
    expect(nudge).not.toHaveBeenCalled();
    expect(await service.review(ctx, source)).toMatchObject({ status: 'ok', units: source.units });
  });

  it('retries publication of a persisted pending offer after inbox append failure', async () => {
    const { service, appendInbox, bindInboxAction, records } = create();
    appendInbox.mockRejectedValueOnce(new Error('inbox unavailable'));
    await service.begin(ctx.executionId, 'bad plan', false);

    await expect(service.review(ctx, source)).rejects.toThrow('inbox unavailable');
    const pending = records.get(ctx.executionId);
    expect(pending).toMatchObject({ status: 'pending', retries: 1 });

    await expect(service.review(ctx, source)).resolves.toBe('wait');
    expect(appendInbox).toHaveBeenCalledTimes(2);
    expect(bindInboxAction).toHaveBeenCalledOnce();
    expect(latestOffer(bindInboxAction)).toMatchObject({
      executionId: ctx.executionId,
      offerId: pending.offeredActionId,
      digest: pending.offeredDigest
    });
  });

  it('retries binding a persisted pending offer after restart', async () => {
    const first = create();
    first.bindInboxAction.mockReturnValueOnce(false);
    await first.service.begin(ctx.executionId, 'bad plan', false);

    await expect(first.service.review(ctx, source)).resolves.toBe('wait');
    const pending = first.records.get(ctx.executionId);
    expect(pending).toMatchObject({ status: 'pending', retries: 1 });

    const appendInbox = vi.fn(async (input) => ({ ...input, id: 'i-restarted', ts: 2 }));
    const bindInboxAction = vi.fn(() => true);
    const restarted = new PlanCorrectionService({
      appendInbox,
      bindInboxAction,
      nudge: vi.fn(),
      readCorrectedPlan: vi.fn(async () => source),
      store: first.store,
      resume: vi.fn(),
      stopExecution: vi.fn()
    });

    await expect(restarted.review(ctx, source)).resolves.toBe('wait');
    expect(appendInbox).toHaveBeenCalledOnce();
    expect(latestOffer(bindInboxAction)).toMatchObject({
      offerId: pending.offeredActionId,
      digest: pending.offeredDigest
    });
  });

  it('detects source-plan markers with portable-plan grammar', () => {
    expect(PlanCorrectionService.sourcePlanPresent('  ### task: Title <!--  EXECUTABLE-STEP  -->')).toBe(true);
  });

  it('presents a review-ready correction with source and proposed plan artifacts', async () => {
    const { service, appendInbox } = create();
    await service.begin(ctx.executionId, 'parser expected a dependency', false);

    await service.review(ctx, source);

    const entry = appendInbox.mock.calls[0]![0];
    expect(entry.comments).toContain('Problem with the supplied plan: parser expected a dependency');
    expect(entry.comments).toContain('Proposed corrected plan: 1 step.');
    expect(entry.comments).toContain('1. **Source** (`source`). No declared file writes.');
    expect(entry.comments).toContain('Review the proposed corrected plan below');
    expect(entry.decisionGuidance).toEqual({
      kind: 'plan-correction',
      diagnostic: 'parser expected a dependency',
      originalPlanPath: '.zana/execution-plan-e-1.md',
      correctedPlanPath: '.zana/execution-plan-corrected-e-1.md'
    });
    expect(entry.questions[0]?.options).toEqual([
      { id: 'approve', label: 'Approve' },
      { id: 'changes', label: 'Request changes' },
      { id: 'cancel', label: 'Cancel' }
    ]);
  });

  describe('automatic normalization notes', () => {
    const normalized = {
      ...source,
      units: [{ id: 'u1', title: 'First', task: 'do it', dependencies: [] }],
      normalizations: ['step "U1" id normalized to "u1"', 'step u2 dependency "U1" normalized to "u1"']
    };

    it('lists repairs on the gated offer without changing options, gating, or digest', async () => {
      const { service, appendInbox, bindInboxAction, readCorrectedPlan } = create();
      readCorrectedPlan.mockResolvedValue(normalized);
      await service.begin(ctx.executionId, 'parser expected a dependency', false);

      await expect(service.review(ctx, normalized)).resolves.toBe('wait');

      const entry = appendInbox.mock.calls[0]![0];
      expect(entry.hostActionRequired).toBe(true);
      expect(entry.comments).toContain('Automatically normalized in the proposed plan:');
      expect(entry.comments).toContain('- step "U1" id normalized to "u1"');
      expect(entry.comments).toContain('- step u2 dependency "U1" normalized to "u1"');
      expect(entry.questions[0]?.options).toEqual([
        { id: 'approve', label: 'Approve' },
        { id: 'changes', label: 'Request changes' },
        { id: 'cancel', label: 'Cancel' }
      ]);
      expect(latestOffer(bindInboxAction).digest).toBe(launchDigest(normalized.units));
    });

    it('approves the normalized offer and returns the normalized units', async () => {
      const { service, bindInboxAction, readCorrectedPlan } = create();
      readCorrectedPlan.mockResolvedValue(normalized);
      await service.begin(ctx.executionId, 'bad plan', false);
      await service.review(ctx, normalized);

      await expect(service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction))).resolves.toBe('approve');
      expect(await service.review(ctx, normalized)).toMatchObject({ status: 'ok', units: normalized.units });
    });

    it('omits the section when the corrected plan needed no repair', async () => {
      const { service, appendInbox } = create();
      await service.begin(ctx.executionId, 'bad plan', false);
      await service.review(ctx, source);
      expect(appendInbox.mock.calls[0]![0].comments).not.toContain('Automatically normalized');
    });

    it('omits the section for an empty notes array', async () => {
      const { service, appendInbox, readCorrectedPlan } = create();
      readCorrectedPlan.mockResolvedValue({ ...source, normalizations: [] });
      await service.begin(ctx.executionId, 'bad plan', false);
      await service.review(ctx, source);
      expect(appendInbox.mock.calls[0]![0].comments).not.toContain('Automatically normalized');
    });

    it('republishes a persisted pending offer with the notes from the fresh read', async () => {
      const { service, appendInbox, readCorrectedPlan } = create();
      readCorrectedPlan.mockResolvedValue(normalized);
      appendInbox.mockRejectedValueOnce(new Error('inbox unavailable'));
      await service.begin(ctx.executionId, 'bad plan', false);
      await expect(service.review(ctx, normalized)).rejects.toThrow('inbox unavailable');

      await expect(service.review(ctx, normalized)).resolves.toBe('wait');
      expect(appendInbox.mock.calls.at(-1)![0].comments).toContain('step "U1" id normalized to "u1"');
    });
  });

  it('requests revision without changing the source plan', async () => {
    const { service, bindInboxAction, nudge, wakeCoordinator } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    await expect(service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction))).resolves.toBe('wait');
    expect(nudge).not.toHaveBeenCalled();
    expect(wakeCoordinator).toHaveBeenCalledWith(ctx.executionId, expect.stringContaining('a copy of the supplied plan is rejected again'), expect.objectContaining({ isCurrent: expect.any(Function), onUnconsumed: expect.any(Function) }));
  });

  it('gives a held coordinator the rejection reason, source plan, grammar and permission to fill gaps', async () => {
    const { service, bindInboxAction, wakeCoordinator } = create();
    await service.begin(ctx.executionId, 'mutating work unit requires file scope', false);
    await service.review(ctx, source);
    await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));

    const text = wakeCoordinator.mock.calls[0]![1] as string;
    expect(text).toContain('mutating work unit requires file scope');
    expect(text).toContain('### write: Write output <!-- executable-step -->');
    expect(text).toContain('execution-plan-corrected-');
    expect(text).toContain('Write scope');
    expect(text).toContain('Do not stop to ask the operator');
  });

  // squad-bugs B2a live repro: coordinators edited the authored plan, re-copied the
  // invalid plan, and went looking for the execution over curl/env.
  it('names the corrected file as the only plan to write and forbids shell or execution.* discovery', async () => {
    const { service, bindInboxAction, wakeCoordinator } = create();
    await service.begin(ctx.executionId, 'mutating work unit requires file scope', false);
    await service.review(ctx, source);
    await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));

    const text = wakeCoordinator.mock.calls[0]![1] as string;
    expect(text).toMatch(/was rejected: /);
    expect(text).toMatch(/corrected portable plan to `\.zana\/execution-plan-corrected-[^`]+`/);
    expect(text).toContain('is the only plan file the host reads');
    expect(text).toContain(`Do not edit the supplied plan, \`.zana/execution-plan-${ctx.executionId}.md\``);
    expect(text).toContain('a copy of the supplied plan is rejected again');
    expect(text).toContain('run shell or network commands');
    expect(text).toContain('The host rereads');
    expect(text).not.toContain('Keep the supplied plan unchanged');
  });

  it('tells the coordinator why its corrected plan is invalid, then escalates with that reason', async () => {
    const { service, appendInbox, bindInboxAction, readCorrectedPlan, wakeCoordinator } = create();
    readCorrectedPlan.mockResolvedValue({ status: 'missing' });
    await service.begin(ctx.executionId, 'mutating work unit requires file scope', false);
    await service.review(ctx, { status: 'invalid', reason: 'bad' });
    await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));
    expect(wakeCoordinator).toHaveBeenCalledOnce();
    readCorrectedPlan.mockResolvedValue({ status: 'invalid', reason: 'step w1:\n mutating work unit requires file scope' });

    // First idle edge: precise feedback to the coordinator, no new operator card.
    await expect(service.reviewInvalid(ctx)).resolves.toBe('wait');
    expect(appendInbox).toHaveBeenCalledOnce();
    expect(wakeCoordinator).toHaveBeenCalledTimes(2);
    const feedback = wakeCoordinator.mock.calls[1]![1] as string;
    expect(feedback).toContain('is still invalid: step w1: mutating work unit requires file scope');
    expect(feedback).toContain(`.zana/execution-plan-corrected-${ctx.executionId}.md`);
    expect(feedback).toContain('Do not call execution.* tools');

    // Stall bound: the operator card names the parser reason, not "no plan written".
    await expect(service.reviewInvalid(ctx)).resolves.toBe('wait');
    expect(wakeCoordinator).toHaveBeenCalledTimes(2);
    expect(appendInbox).toHaveBeenCalledTimes(2);
    const comments = appendInbox.mock.calls[1]![0].comments as string;
    expect(comments).toContain("The coordinator's corrected plan is still invalid: step w1: mutating work unit requires file scope.");
    expect(comments).not.toContain('without writing a corrected plan');
    expect(latestOffer(bindInboxAction).digest).toBe('');
  });

  it('falls back to a session nudge for invalid-correction feedback without a wake queue', async () => {
    const base = create();
    const service = new PlanCorrectionService({
      appendInbox: base.appendInbox, bindInboxAction: base.bindInboxAction, nudge: base.nudge,
      readSourcePlan: base.readSourcePlan, readCorrectedPlan: base.readCorrectedPlan, store: base.store,
      resume: base.resume, stopExecution: base.stopExecution
    });
    base.readCorrectedPlan.mockResolvedValue({ status: 'missing' });
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, { status: 'invalid', reason: 'bad' });
    await service.respond(ctx.executionId, 'changes', latestOffer(base.bindInboxAction));
    base.readCorrectedPlan.mockResolvedValue({ status: 'invalid', reason: 'no steps' });
    await service.reviewInvalid(ctx);
    expect(base.nudge).toHaveBeenLastCalledWith(ctx.sessionId, expect.stringContaining('is still invalid: no steps'));
  });

  it('still instructs the coordinator when the source plan cannot be read', async () => {
    const { service, bindInboxAction, wakeCoordinator, readSourcePlan } = create();
    readSourcePlan.mockRejectedValueOnce(new Error('store unavailable'));
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));

    const text = wakeCoordinator.mock.calls[0]![1] as string;
    expect(text).toContain('bad plan');
    expect(text).not.toContain('Supplied plan:');
  });

  it('truncates an oversized source plan in the coordinator request', async () => {
    const { service, bindInboxAction, wakeCoordinator, readSourcePlan } = create();
    readSourcePlan.mockResolvedValueOnce('x'.repeat(20_000));
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));

    const text = wakeCoordinator.mock.calls[0]![1] as string;
    expect(text).toContain('[truncated]');
    expect(text.length).toBeLessThanOrEqual(COORDINATOR_WAKE_MESSAGE_MAX);
  });

  // The durable wake queue rejects any message over its string cap; an over-long
  // correction request was dropped and the coordinator never heard about it.
  it('fits every correction request within the durable wake cap for a real execution id and long reason', async () => {
    const { service, bindInboxAction, wakeCoordinator, readSourcePlan } = create();
    const realCtx = { ...ctx, executionId: '38b87318-0000-4000-8000-000000000000' };
    readSourcePlan.mockResolvedValue('### a: A <!-- executable-step -->\n'.repeat(400));
    await service.begin(realCtx.executionId, `reason ${'r'.repeat(3_000)}`, false);
    await service.review(realCtx, source);
    await service.respond(realCtx.executionId, 'changes', latestOffer(bindInboxAction));
    const text = wakeCoordinator.mock.calls[0]![1] as string;
    expect(text.length).toBeLessThanOrEqual(COORDINATOR_WAKE_MESSAGE_MAX);
    expect(text).toContain('Supplied plan:');
    expect(text).toMatch(/corrected portable plan to `\.zana\/execution-plan-corrected-38b87318-[^`]+`/);
    expect(text).toContain('Then end your turn.');
    // Canonical-mode terminals drop input lines over 1024 bytes.
    for (const line of text.split('\n')) expect(Buffer.byteLength(line)).toBeLessThan(1024);
  });

  it('keeps the store cap in sync with the wake queue validation', async () => {
    const { readFileSync } = await import('node:fs');
    const storeSource = readFileSync(new URL('../../../server/src/services/execution/store.ts', import.meta.url), 'utf8');
    expect(storeSource).toMatch(new RegExp(`const MAX_STRING = ${COORDINATOR_WAKE_MESSAGE_MAX.toLocaleString('en-US').replace(',', '_')};`));
  });

  // Reproduces the live MT-6 failure: wake delivered, coordinator idles repeatedly
  // and never writes the corrected plan. The operator must get a card, not silence.
  it('surfaces a stalled-coordinator card instead of waiting forever for a missing corrected plan', async () => {
    const { service, appendInbox, bindInboxAction, readCorrectedPlan } = create();
    readCorrectedPlan.mockResolvedValue({ status: 'missing' });
    const invalid = { status: 'invalid' as const, reason: 'missing Write scope' };
    await service.begin(ctx.executionId, 'mutating work unit requires file scope', false);
    await service.review(ctx, invalid);
    await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));
    expect(appendInbox).toHaveBeenCalledOnce();

    for (let edge = 1; edge < PLAN_CORRECTION_STALL_IDLE_EDGES; edge += 1) {
      await expect(service.reviewInvalid(ctx)).resolves.toBe('wait');
      expect(appendInbox).toHaveBeenCalledOnce();
    }
    await expect(service.reviewInvalid(ctx)).resolves.toBe('wait');

    expect(appendInbox).toHaveBeenCalledTimes(2);
    expect(appendInbox.mock.calls[1]![0].comments).toContain('without writing a corrected plan');
    expect(latestOffer(bindInboxAction).digest).toBe('');
  });

  it('does not report a stall once the coordinator writes a corrected plan', async () => {
    const { service, appendInbox, bindInboxAction, readCorrectedPlan } = create();
    readCorrectedPlan.mockResolvedValue({ status: 'missing' });
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, { status: 'invalid', reason: 'bad' });
    await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));
    await service.reviewInvalid(ctx);

    readCorrectedPlan.mockResolvedValue(source);
    await service.reviewInvalid(ctx);
    expect(appendInbox).toHaveBeenCalledTimes(2);
    expect(appendInbox.mock.calls[1]![0].comments).not.toContain('without writing');
    expect(latestOffer(bindInboxAction).digest).not.toBe('');
  });

  it('restarts the stall count after a fresh Request changes', async () => {
    const { service, appendInbox, bindInboxAction, readCorrectedPlan } = create();
    readCorrectedPlan.mockResolvedValue({ status: 'missing' });
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, { status: 'invalid', reason: 'bad' });
    await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));
    await service.reviewInvalid(ctx);
    readCorrectedPlan.mockResolvedValue(source);
    await service.reviewInvalid(ctx);
    await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));
    readCorrectedPlan.mockResolvedValue({ status: 'missing' });
    const before = appendInbox.mock.calls.length;

    await service.reviewInvalid(ctx);
    expect(appendInbox).toHaveBeenCalledTimes(before);
  });

  it('uses the initial Inbox card to request correction without repeating it while waiting', async () => {
    const { service, appendInbox, bindInboxAction, records, nudge, wakeCoordinator, readCorrectedPlan } = create();
    const invalid = { status: 'invalid' as const, reason: 'missing steps' };
    readCorrectedPlan.mockResolvedValue({ status: 'missing' });
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, invalid);
    expect(appendInbox).toHaveBeenCalledOnce();
    expect(nudge).not.toHaveBeenCalled();
    const firstOffer = latestOffer(bindInboxAction);
    expect(firstOffer.digest).toBe('');
    await expect(service.respond(ctx.executionId, 'changes', firstOffer)).resolves.toBe('wait');
    expect(nudge).not.toHaveBeenCalled();
    expect(wakeCoordinator).toHaveBeenCalledOnce();

    readCorrectedPlan.mockResolvedValue(source);
    await service.review(ctx, source);
    expect(appendInbox).toHaveBeenCalledTimes(2);
    await expect(service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction))).resolves.toBe('wait');
    expect(records.get(ctx.executionId)).toMatchObject({ status: 'correction-required' });

    readCorrectedPlan.mockResolvedValue({ status: 'missing' });
    await service.review(ctx, invalid);
    expect(appendInbox).toHaveBeenCalledTimes(2);

    readCorrectedPlan.mockResolvedValue(source);
    await service.review(ctx, source);
    expect(appendInbox).toHaveBeenCalledTimes(3);
  });

  it('does not nudge the coordinator until the operator requests correction', async () => {
    const { service, nudge, appendInbox, readCorrectedPlan } = create();
    readCorrectedPlan.mockResolvedValue({ status: 'missing' });
    await service.begin(ctx.executionId, 'bad plan', false);

    await expect(service.reviewInvalid(ctx)).resolves.toBe('wait');
    expect(nudge).not.toHaveBeenCalled();
    expect(appendInbox).toHaveBeenCalledOnce();
  });

  it('shows an initial operator decision for a first invalid corrected-plan artifact', async () => {
    const { service, nudge, appendInbox, readCorrectedPlan } = create();
    readCorrectedPlan.mockResolvedValue({ status: 'invalid', reason: 'missing Write scope' });
    await service.begin(ctx.executionId, 'bad plan', false);

    await expect(service.reviewInvalid(ctx)).resolves.toBe('wait');

    expect(nudge).not.toHaveBeenCalled();
    expect(appendInbox).toHaveBeenCalledOnce();
  });

  it('coalesces a retried pending offer under its durable offer id', async () => {
    const { service, appendInbox, bindInboxAction, records } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    const pending = records.get(ctx.executionId);
    const entry = appendInbox.mock.calls[0]![0];

    expect(entry.dedupeKey).toBe(`plan-correction:e-1:${pending.offeredActionId}`);
    await service.review(ctx, source);
    expect(appendInbox).toHaveBeenCalledOnce();
    expect(bindInboxAction).toHaveBeenCalledOnce();
  });

  it('does not expose approval on the initial correction request', async () => {
    const { service, bindInboxAction, readCorrectedPlan, resume } = create();
    const invalid = { status: 'invalid' as const, reason: 'missing steps' };
    readCorrectedPlan.mockResolvedValue(invalid);
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, invalid);

    const offer = latestOffer(bindInboxAction);
    expect(offer.digest).toBe('');
    expect(resume).not.toHaveBeenCalled();
  });

  it('rejects unattended correction and cancellation', async () => {
    const { service, bindInboxAction } = create();
    await service.begin(ctx.executionId, 'bad plan', true);
    expect(await service.review(ctx, source)).toBe('reject');
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    await expect(service.respond(ctx.executionId, 'cancel', latestOffer(bindInboxAction))).resolves.toBe('cancelled');
    expect(await service.review(ctx, source)).toBe('reject');
  });

  it('completes cancellation without allowing retry or approval to revive execution', async () => {
    const { service, bindInboxAction, records, resume, stopExecution } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    const offer = latestOffer(bindInboxAction);

    await expect(service.respond(ctx.executionId, 'cancel', offer)).resolves.toBe('cancelled');
    expect(records.get(ctx.executionId)).toMatchObject({ status: 'cancelled' });
    expect(stopExecution).toHaveBeenCalledWith(ctx.executionId);
    await expect(service.respond(ctx.executionId, 'cancel', offer)).resolves.toBe('cancelled');
    await expect(service.respond(ctx.executionId, 'approve', offer)).resolves.toBe('reject');
    expect(stopExecution).toHaveBeenCalledTimes(3);
    expect(resume).not.toHaveBeenCalled();
    await expect(service.authorizeRegistration(ctx.executionId, source.units)).resolves.toEqual({
      ok: false, message: 'plan correction was cancelled'
    });
  });

  it('retries cancelled execution cleanup after restart without reviving correction', async () => {
    const first = create();
    first.stopExecution.mockRejectedValueOnce(new Error('temporary Team teardown failure'));
    await first.service.begin(ctx.executionId, 'bad plan', false);
    await first.service.review(ctx, source);

    await expect(first.service.respond(ctx.executionId, 'cancel', latestOffer(first.bindInboxAction)))
      .rejects.toThrow('temporary Team teardown failure');
    expect(first.records.get(ctx.executionId)).toMatchObject({ status: 'cancelled' });

    const stopExecution = vi.fn(async () => {});
    const restarted = new PlanCorrectionService({
      appendInbox: vi.fn(), bindInboxAction: vi.fn(() => true), nudge: vi.fn(), readCorrectedPlan: vi.fn(),
      store: first.store, resume: vi.fn(), stopExecution
    });
    await restarted.recoverCancelledExecutions();

    expect(stopExecution).toHaveBeenCalledWith(ctx.executionId);
    await expect(restarted.authorizeRegistration(ctx.executionId, source.units)).resolves.toEqual({
      ok: false, message: 'plan correction was cancelled'
    });
    await expect(restarted.respond(ctx.executionId, 'approve', latestOffer(first.bindInboxAction))).resolves.toBe('reject');
  });

  it('retries cancelled execution cleanup on later coordinator recovery edges', async () => {
    const { service, bindInboxAction, stopExecution } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    await service.respond(ctx.executionId, 'cancel', latestOffer(bindInboxAction));

    await expect(service.review(ctx, source)).resolves.toBe('reject');
    expect(stopExecution).toHaveBeenCalledTimes(2);
  });

  it('completes cancelled host action and rejects replayed approval', async () => {
    const { service, bindInboxAction, resume } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    const offer = latestOffer(bindInboxAction);
    const ref = JSON.stringify(offer);

    await expect(runPlanCorrectionHostAction(service, ref, 'cancel')).resolves.toBeUndefined();
    await expect(runPlanCorrectionHostAction(service, ref, 'approve')).rejects.toThrow('plan correction action was rejected or superseded');
    expect(resume).not.toHaveBeenCalled();
  });

  it('serializes concurrent cancel and approval so cancellation cannot resume the coordinator', async () => {
    const { service, bindInboxAction, resume, stopExecution } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    const offer = latestOffer(bindInboxAction);

    const [cancelled, approval] = await Promise.all([
      service.respond(ctx.executionId, 'cancel', offer),
      service.respond(ctx.executionId, 'approve', offer)
    ]);

    expect(cancelled).toBe('cancelled');
    expect(approval).toBe('reject');
    // The queued approval observes the durable cancellation and re-drives only
    // idempotent terminal cleanup; it cannot resume coordinator work.
    expect(stopExecution).toHaveBeenCalledTimes(2);
    expect(resume).not.toHaveBeenCalled();
  });

  it('serializes review with cancellation so stale review cannot overwrite durable cancellation', async () => {
    const { service, bindInboxAction, readCorrectedPlan, records, resume } = create();
    let releaseRead!: () => void;
    readCorrectedPlan.mockImplementationOnce(async () => new Promise<typeof source>((resolve) => {
      releaseRead = () => resolve(source);
    }));
    await service.begin(ctx.executionId, 'bad plan', false);

    const reviewing = service.review(ctx, source);
    await vi.waitFor(() => expect(readCorrectedPlan).toHaveBeenCalledOnce());
    releaseRead();

    expect(await reviewing).toBe('wait');
    const offer = latestOffer(bindInboxAction);
    await expect(service.respond(ctx.executionId, 'cancel', offer)).resolves.toBe('cancelled');
    expect(records.get(ctx.executionId)).toMatchObject({ status: 'cancelled' });
    await expect(service.respond(ctx.executionId, 'approve', offer)).resolves.toBe('reject');
    expect(resume).not.toHaveBeenCalled();
  });

  it('continues boot cleanup after one cancelled record fails and reports that record', async () => {
    const { records } = create();
    records.set('e-fail', { ...recordFor(ctx, 'e-fail'), status: 'cancelled' });
    records.set('e-next', { ...recordFor(ctx, 'e-next'), status: 'cancelled' });
    const stopExecution = vi.fn(async (executionId: string) => {
      if (executionId === 'e-fail') throw new Error('teardown failed');
    });
    const logRecoveryError = vi.fn();
    const restarted = new PlanCorrectionService({
      appendInbox: vi.fn(), bindInboxAction: vi.fn(() => true), nudge: vi.fn(), readCorrectedPlan: vi.fn(),
      store: { get: async (id) => records.get(id), listCancelled: async () => [...records.values()].filter((entry) => entry.status === 'cancelled'), put: async (entry) => { records.set(entry.executionId, structuredClone(entry)); return entry; } },
      resume: vi.fn(), stopExecution, logRecoveryError
    });

    await expect(restarted.recoverCancelledExecutions()).resolves.toEqual([
      expect.objectContaining({ executionId: 'e-fail', error: expect.any(Error) })
    ]);
    expect(stopExecution).toHaveBeenCalledWith('e-fail');
    expect(stopExecution).toHaveBeenCalledWith('e-next');
    expect(logRecoveryError).toHaveBeenCalledWith('e-fail', expect.any(Error));
  });

  it('caps correction prompts at three', async () => {
    const { service, appendInbox, bindInboxAction } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    for (let attempt = 0; attempt < PLAN_CORRECTION_MAX_RETRIES; attempt++) {
      expect(await service.review(ctx, source)).toBe('wait');
      if (attempt + 1 < PLAN_CORRECTION_MAX_RETRIES) await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));
    }
    // Final offered request stays pending until user explicitly answers.
    expect(await service.review(ctx, source)).toBe('wait');
    await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));
    expect(await service.review(ctx, source)).toBe('reject');
    expect(appendInbox).toHaveBeenCalledTimes(PLAN_CORRECTION_MAX_RETRIES);
  });

  it('accepts approval for the final offered correction', async () => {
    const { service, appendInbox, bindInboxAction } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    for (let attempt = 0; attempt < PLAN_CORRECTION_MAX_RETRIES; attempt++) {
      expect(await service.review(ctx, source)).toBe('wait');
      if (attempt + 1 < PLAN_CORRECTION_MAX_RETRIES) await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));
    }

    await expect(service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction))).resolves.toBe('approve');
    expect(await service.review(ctx, source)).toMatchObject({ status: 'ok', units: source.units });
    expect(appendInbox).toHaveBeenCalledTimes(PLAN_CORRECTION_MAX_RETRIES);
  });

  it('leaves non-correction invalid plans to normal handoff nudges', async () => {
    const { service } = create();
    await expect(service.reviewInvalid(ctx)).resolves.toBeUndefined();
  });

  it('reads corrected plan for invalid authored handoff and retains its pending offer', async () => {
    const { service, appendInbox, records } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    expect(await service.reviewInvalid(ctx)).toBe('wait');
    const pending = records.get(ctx.executionId);
    expect(appendInbox).toHaveBeenCalledOnce();
    expect(pending).toMatchObject({ status: 'pending', offeredUnits: source.units });
    // The card names the launch defect recorded by begin().
    expect(pending.reason).toBe('bad plan');
    expect(appendInbox.mock.calls[0]![0].comments).toContain('Problem with the supplied plan: bad plan');
    expect(appendInbox.mock.calls[0]![0].comments).not.toContain('authored plan is invalid');
    expect(appendInbox.mock.calls[0]![0].decisionGuidance).toMatchObject({ diagnostic: 'bad plan' });

    expect(await service.reviewInvalid(ctx)).toBe('wait');
    expect(appendInbox).toHaveBeenCalledOnce();
    expect(records.get(ctx.executionId)).toMatchObject({
      status: 'pending', offeredDigest: pending.offeredDigest, offeredActionId: pending.offeredActionId
    });
  });

  it('rejects approval against a superseded immutable offer', async () => {
    const { service, bindInboxAction, readCorrectedPlan, resume } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    const first = JSON.parse(bindInboxAction.mock.calls[0][1].ref);
    const changed = { ...source, units: [{ ...source.units[0], task: 'new offer' }] };
    readCorrectedPlan.mockResolvedValue(changed);
    await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));
    await service.review(ctx, source);

    await expect(service.respond(ctx.executionId, 'approve', first)).resolves.toBe('reject');
    expect(resume).not.toHaveBeenCalled();
    await expect(service.authorizeRegistration(ctx.executionId, changed.units)).resolves.toEqual({
      ok: false, message: 'plan correction approval is pending'
    });
  });

  it('requires renewed approval when corrected content changes after approval', async () => {
    const { service, bindInboxAction, readCorrectedPlan } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    await service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction));
    await expect(service.authorizeRegistration(ctx.executionId, source.units)).resolves.toEqual({ ok: true });

    const changed = { ...source, units: [{ ...source.units[0], task: 'different task' }] };
    readCorrectedPlan.mockResolvedValue(changed);
    expect(await service.review(ctx, source)).toBe('wait');
    await expect(service.authorizeRegistration(ctx.executionId, changed.units)).resolves.toEqual({
      ok: false, message: 'plan correction approval is pending'
    });
  });

  it('keeps third correction request pending until human answers', async () => {
    const { service, appendInbox, bindInboxAction } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    for (let attempt = 0; attempt < PLAN_CORRECTION_MAX_RETRIES; attempt++) {
      expect(await service.review(ctx, source)).toBe('wait');
      if (attempt + 1 < PLAN_CORRECTION_MAX_RETRIES) await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));
    }
    await expect(service.isPending(ctx.executionId)).resolves.toBe(true);
    expect(await service.review(ctx, source)).toBe('wait');
    expect(appendInbox).toHaveBeenCalledTimes(PLAN_CORRECTION_MAX_RETRIES);
  });

  it('denies registration while correction is pending or cancelled', async () => {
    const { service, bindInboxAction } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await expect(service.authorizeRegistration(ctx.executionId, source.units)).resolves.toEqual({
      ok: false, message: 'plan correction approval is pending'
    });
    await service.review(ctx, source);
    await service.respond(ctx.executionId, 'cancel', latestOffer(bindInboxAction));
    await expect(service.authorizeRegistration(ctx.executionId, source.units)).resolves.toEqual({
      ok: false, message: 'plan correction was cancelled'
    });
  });

  it('allows normal registration when no correction record exists', async () => {
    const { service } = create();
    await expect(service.authorizeRegistration(ctx.executionId, source.units)).resolves.toEqual({ ok: true });
  });

  it('captures offer before inbox action and approves only that immutable snapshot', async () => {
    const { service, appendInbox, bindInboxAction, readCorrectedPlan, resume } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    const offered = { ...source, units: [{ ...source.units[0], task: 'offered task' }] };
    readCorrectedPlan.mockResolvedValue(offered);
    await service.review(ctx, source);
    expect(appendInbox).toHaveBeenCalledTimes(2);
    const changed = { ...offered, units: [{ ...offered.units[0], task: 'changed after offer' }] };
    readCorrectedPlan.mockResolvedValue(changed);
    await expect(service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction))).resolves.toBe('wait');
    await expect(service.authorizeRegistration(ctx.executionId, offered.units)).resolves.toEqual({
      ok: false, message: 'plan correction approval is pending'
    });
    expect(resume).not.toHaveBeenCalled();
  });

  it('persists cancellation and resumes approval with stored coordinator context', async () => {
    const { service, bindInboxAction, resume, records } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    await service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction));
    expect(resume).toHaveBeenCalledWith(ctx);
    const restarted = new PlanCorrectionService({
      appendInbox: vi.fn(), bindInboxAction: vi.fn(() => true), nudge: vi.fn(), readCorrectedPlan: vi.fn(),
      store: { get: async (id) => records.get(id), put: async (record) => { records.set(record.executionId, structuredClone(record)); return record; } },
      resume: vi.fn(), stopExecution: vi.fn()
    });
    await expect(restarted.authorizeRegistration(ctx.executionId, source.units)).resolves.toEqual({ ok: true });
    await expect(restarted.approvedPlan(ctx.executionId)).resolves.toMatchObject({ units: source.units });
    await service.begin('e-cancelled', 'bad plan', false);
    await service.review({ ...ctx, executionId: 'e-cancelled' }, source);
    await service.respond('e-cancelled', 'cancel', latestOffer(bindInboxAction));
    await expect(restarted.authorizeRegistration('e-cancelled', source.units)).resolves.toEqual({
      ok: false, message: 'plan correction was cancelled'
    });
  });

  it('reads details artifacts from approved correction worktree, not renderer project path', async () => {
    const worktree = mkdtempSync(join(tmpdir(), 'zcc-correction-worktree-'));
    const rendererProject = mkdtempSync(join(tmpdir(), 'zcc-renderer-project-'));
    try {
      mkdirSync(join(worktree, '.zana'));
      mkdirSync(join(rendererProject, '.zana'));
      writeFileSync(join(worktree, '.zana', 'execution-plan-corrected-e-1.md'), 'worktree artifact');
      writeFileSync(join(rendererProject, '.zana', 'execution-plan-corrected-e-1.md'), 'renderer artifact');
      const { service, bindInboxAction } = create();
      const worktreeCtx = { ...ctx, projectRoot: worktree };
      await service.begin(worktreeCtx.executionId, 'bad plan', false);
      await service.review(worktreeCtx, source);
      const ref = bindInboxAction.mock.calls[0][1].ref;
      await expect(service.readArtifact(ref, '.zana/execution-plan-corrected-e-1.md')).resolves.toBe('worktree artifact');
      await expect(service.readArtifact(ref, '../outside.md')).resolves.toBeUndefined();
    } finally {
      rmSync(worktree, { recursive: true, force: true });
      rmSync(rendererProject, { recursive: true, force: true });
    }
  });
});

function recordFor(base: typeof ctx, executionId: string) {
  return {
    executionId,
    ctx: { ...base, executionId },
    reason: 'bad plan',
    retries: 1,
    status: 'pending' as const
  };
}

/**
 * squad-bugs: correction identity and digest races. An offer is bound to one
 * execution and one normalized-unit digest; neither another execution's offer nor
 * a file that changed between offer and approve may resume the coordinator.
 */
describe('PlanCorrectionService identity and digest races (squad-bugs)', () => {
  it('rejects an offer from another execution and resumes nothing', async () => {
    const { service, bindInboxAction, resume } = create();
    await service.begin('e-a', 'bad plan', false);
    await service.review({ ...ctx, executionId: 'e-a' }, source);
    const offerA = latestOffer(bindInboxAction);
    await service.begin('e-b', 'bad plan', false);
    await service.review({ ...ctx, executionId: 'e-b' }, source);

    await expect(service.respond('e-b', 'approve', offerA)).resolves.toBe('reject');
    expect(resume).not.toHaveBeenCalled();
  });

  it('a file edited between offer and approve is not resumed and requires a new offer digest', async () => {
    const { service, bindInboxAction, readCorrectedPlan, resume, records } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    const offer = latestOffer(bindInboxAction);
    const offeredDigest = records.get(ctx.executionId).offeredDigest;
    readCorrectedPlan.mockResolvedValue({ ...source, units: [{ ...source.units[0], task: 'edited after offer' }] });

    await expect(service.respond(ctx.executionId, 'approve', offer)).resolves.toBe('wait');
    expect(resume).not.toHaveBeenCalled();
    expect(records.get(ctx.executionId).status).not.toBe('approved');
    expect(records.get(ctx.executionId).approvedDigest).toBeUndefined();
    expect(offeredDigest).toBe(launchDigest(source.units));
  });

  it('two concurrent approvals of one offer resume exactly once', async () => {
    const { service, bindInboxAction, resume } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    const offer = latestOffer(bindInboxAction);

    await Promise.all([service.respond(ctx.executionId, 'approve', offer), service.respond(ctx.executionId, 'approve', offer)]);
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('registration of a digest different from the approved one is denied', async () => {
    const { service, bindInboxAction } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    await service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction));
    const other = [{ ...source.units[0], task: 'not the approved task' }];

    await expect(service.authorizeRegistration(ctx.executionId, other)).resolves.toMatchObject({ ok: false });
  });
});

describe('approve-time reread trace', () => {
  function traced(trace: (event: unknown) => void) {
    const base = create();
    const service = new PlanCorrectionService({
      appendInbox: base.appendInbox, bindInboxAction: base.bindInboxAction, nudge: base.nudge, wakeCoordinator: base.wakeCoordinator,
      readSourcePlan: base.readSourcePlan, readCorrectedPlan: base.readCorrectedPlan, store: base.store,
      updateScheduledPrompt: base.updateScheduledPrompt, resume: base.resume, stopExecution: base.stopExecution, trace
    });
    return { ...base, service };
  }

  it('records a matching reread with digests and no plan body', async () => {
    const trace = vi.fn();
    const { service, bindInboxAction, readCorrectedPlan } = traced(trace);
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    readCorrectedPlan.mockResolvedValue({ ...source, bodyDigest: 'sha256:abc' });
    await expect(service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction))).resolves.toBe('approve');
    const digest = launchDigest(source.units);
    const rereads = trace.mock.calls.filter(([event]) => (event as { stage: string }).stage === 'reread');
    expect(rereads).toHaveLength(1);
    expect(trace).toHaveBeenCalledWith({
      executionId: ctx.executionId, sessionId: ctx.sessionId, slotId: ctx.slotId, stage: 'reread',
      status: 'ok', bodyDigest: 'sha256:abc', offeredDigest: digest, rereadDigest: digest, match: true
    });
    expect(JSON.stringify(trace.mock.calls)).not.toContain('"task"');
  });

  it('records a changed or missing reread as a mismatch and still requires correction', async () => {
    const trace = vi.fn();
    const { service, bindInboxAction, readCorrectedPlan, nudge, wakeCoordinator } = traced(trace);
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    const changed = { ...source, units: [{ ...source.units[0], task: 'changed' }] };
    readCorrectedPlan.mockResolvedValue(changed);
    await expect(service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction))).resolves.toBe('wait');
    const rereadOf = () => trace.mock.calls.map(([event]) => event).filter((event) => (event as { stage: string }).stage === 'reread');
    expect(rereadOf()[0]).toMatchObject({ status: 'ok', match: false, rereadDigest: launchDigest(changed.units), offeredDigest: launchDigest(source.units) });
    expect(nudge.mock.calls.length + wakeCoordinator.mock.calls.length).toBeGreaterThan(0);

    trace.mockClear();
    readCorrectedPlan.mockResolvedValue(source);
    await service.review(ctx, source);
    readCorrectedPlan.mockResolvedValue({ status: 'missing' });
    await expect(service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction))).resolves.toBe('wait');
    expect(rereadOf()[0]).toEqual({
      executionId: ctx.executionId, sessionId: ctx.sessionId, slotId: ctx.slotId, stage: 'reread',
      status: 'missing', offeredDigest: launchDigest(source.units), match: false
    });
  });

  it('records every idle-edge review of the corrected file, with a bounded invalid reason', async () => {
    const trace = vi.fn();
    const { service, bindInboxAction, readCorrectedPlan } = traced(trace);
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    expect(trace).toHaveBeenLastCalledWith(expect.objectContaining({ stage: 'review', status: 'ok', match: false }));
    await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));
    readCorrectedPlan.mockResolvedValue({ status: 'invalid', reason: `bad ${'x'.repeat(2_000)}`, bodyDigest: 'sha256:def' } as never);
    await service.reviewInvalid(ctx);
    const last = trace.mock.calls.at(-1)![0] as { stage: string; status: string; reason: string; bodyDigest: string };
    expect(last).toMatchObject({ stage: 'review', status: 'invalid', bodyDigest: 'sha256:def' });
    expect(last.reason.startsWith('bad x')).toBe(true);
    expect(last.reason.length).toBeLessThan(2_000);
  });

  it('a throwing trace sink does not change the approval decision', async () => {
    const { service, bindInboxAction, resume } = traced(() => { throw new Error('sink down'); });
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.review(ctx, source);
    await expect(service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction))).resolves.toBe('approve');
    expect(resume).toHaveBeenCalled();
  });
});

describe('register-channel correction offers (Modern coordinator submissions)', () => {
  const submitted = [{ id: 'fixed', title: 'Fixed', task: 'fixed', dependencies: [], files: ['out.txt'], verification: ['check'] }];
  const revised = [{ ...submitted[0]!, task: 'revised' }];
  const held = { ok: false, message: PLAN_CORRECTION_HELD_MESSAGE };

  it('turns the first refused submission into one approvable offer and approves its snapshot without a file reread', async () => {
    const { service, appendInbox, bindInboxAction, readCorrectedPlan, resume, records } = create();
    await service.begin(ctx.executionId, 'bad plan', false);

    await expect(service.authorizeRegistration(ctx.executionId, submitted, ctx)).resolves.toEqual(held);
    expect(appendInbox).toHaveBeenCalledOnce();
    const card = appendInbox.mock.calls[0]![0];
    expect(card.questions[0].options.map((option: { id: string }) => option.id)).toEqual(['approve', 'changes', 'cancel']);
    expect(card.decisionGuidance).toEqual({ kind: 'plan-correction', diagnostic: 'bad plan' });
    expect(card.sessionId).toBe(ctx.sessionId);
    expect(records.get(ctx.executionId)).toMatchObject({ status: 'pending', channel: 'register', retries: 1, ctx, offeredDigest: launchDigest(submitted) });

    await expect(service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction))).resolves.toBe('approve');
    expect(readCorrectedPlan).not.toHaveBeenCalled();
    expect(resume).toHaveBeenCalledWith(ctx);
    // The host handoff re-entry returns the approved snapshot even though no corrected file exists.
    readCorrectedPlan.mockResolvedValueOnce({ status: 'missing' } as never);
    await expect(service.review(ctx, source)).resolves.toMatchObject({ status: 'ok', units: submitted });
    await expect(service.authorizeRegistration(ctx.executionId, submitted, ctx)).resolves.toEqual({ ok: true });
    await expect(service.authorizeRegistration(ctx.executionId, revised, ctx)).resolves.toEqual({
      ok: false, message: 'corrected plan changed after approval; renewed approval is required'
    });
  });

  it('never adds a second card or replaces the open offer on duplicate or concurrent submissions', async () => {
    const { service, appendInbox, records } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    const results = await Promise.all([
      service.authorizeRegistration(ctx.executionId, submitted, ctx),
      service.authorizeRegistration(ctx.executionId, revised, ctx)
    ]);
    expect(results).toEqual([held, held]);
    await service.authorizeRegistration(ctx.executionId, revised, ctx);
    expect(appendInbox).toHaveBeenCalledOnce();
    expect(records.get(ctx.executionId)).toMatchObject({ retries: 1, offeredDigest: launchDigest(submitted) });
  });

  it('re-publishes the same durable offer after a lost bind, without minting a new offer', async () => {
    const { service, appendInbox, bindInboxAction, records } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    bindInboxAction.mockReturnValueOnce(false);
    await service.authorizeRegistration(ctx.executionId, submitted, ctx);
    const offerId = records.get(ctx.executionId).offeredActionId;
    await service.authorizeRegistration(ctx.executionId, revised, ctx);
    expect(appendInbox).toHaveBeenCalledTimes(2);
    expect(appendInbox.mock.calls[1]![0].dedupeKey).toBe(appendInbox.mock.calls[0]![0].dedupeKey);
    expect(records.get(ctx.executionId)).toMatchObject({ offeredActionId: offerId, retries: 1, offeredDigest: launchDigest(submitted) });
    // Now bound: a further submission publishes nothing.
    await service.authorizeRegistration(ctx.executionId, revised, ctx);
    expect(appendInbox).toHaveBeenCalledTimes(2);
  });

  it('request changes wakes with the register instruction; the next submission is a new offer and the stale one is rejected', async () => {
    const { service, appendInbox, bindInboxAction, wakeCoordinator } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.authorizeRegistration(ctx.executionId, submitted, ctx);
    const first = latestOffer(bindInboxAction);
    await expect(service.respond(ctx.executionId, 'changes', first)).resolves.toBe('wait');
    const wake = wakeCoordinator.mock.calls.at(-1)![1] as string;
    expect(wake).toContain('execution.plan.register');
    expect(wake).toContain('bad plan');
    expect(wake).not.toContain('.zana/');
    expect(wake.length).toBeLessThanOrEqual(COORDINATOR_WAKE_MESSAGE_MAX);

    await service.authorizeRegistration(ctx.executionId, revised, ctx);
    expect(appendInbox).toHaveBeenCalledTimes(2);
    const second = latestOffer(bindInboxAction);
    expect(second.offerId).not.toBe(first.offerId);
    expect(second.digest).toBe(launchDigest(revised));
    await expect(service.respond(ctx.executionId, 'approve', first)).resolves.toBe('reject');
    await expect(service.respond(ctx.executionId, 'approve', second)).resolves.toBe('approve');
  });

  it('refuses without a card once correction attempts are exhausted (unattended)', async () => {
    const { service, appendInbox } = create();
    await service.begin(ctx.executionId, 'bad plan', true);
    await expect(service.authorizeRegistration(ctx.executionId, submitted, ctx)).resolves.toEqual({
      ok: false, message: 'plan correction approval is pending'
    });
    expect(appendInbox).not.toHaveBeenCalled();
  });

  it('ignores a submitter bound to another execution and a missing submitter', async () => {
    const { service, appendInbox } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await expect(service.authorizeRegistration(ctx.executionId, submitted, { ...ctx, executionId: 'other' })).resolves.toEqual({
      ok: false, message: 'plan correction approval is pending'
    });
    await expect(service.authorizeRegistration(ctx.executionId, submitted)).resolves.toEqual({
      ok: false, message: 'plan correction approval is pending'
    });
    expect(appendInbox).not.toHaveBeenCalled();
  });

  it('a cancellation that wins the offer write publishes nothing and reports cancellation', async () => {
    const { service, appendInbox, store, records, stopExecution } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    const put = store.put.getMockImplementation()!;
    store.put.mockImplementationOnce(async (record) => {
      records.set(record.executionId, { ...structuredClone(record), status: 'cancelled' });
      return put(record);
    });
    await expect(service.authorizeRegistration(ctx.executionId, submitted, ctx)).resolves.toEqual({
      ok: false, message: 'plan correction was cancelled'
    });
    expect(appendInbox).not.toHaveBeenCalled();
    expect(stopExecution).toHaveBeenCalledWith(ctx.executionId);
  });

  it('a cancellation or approval that lands while the submission waits is honoured', async () => {
    const { service, store, records, stopExecution } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    // First read sees an open correction; the serialized reread sees the race outcome.
    const get = store.get.getMockImplementation()!;
    store.get.mockImplementationOnce(get).mockImplementationOnce(async (id: string) => ({ ...(await get(id)), status: 'cancelled' }));
    await expect(service.authorizeRegistration(ctx.executionId, submitted, ctx)).resolves.toEqual({
      ok: false, message: 'plan correction was cancelled'
    });
    expect(stopExecution).toHaveBeenCalledWith(ctx.executionId);
    store.get.mockImplementationOnce(get).mockImplementationOnce(async () => undefined);
    await expect(service.authorizeRegistration(ctx.executionId, submitted, ctx)).resolves.toEqual({
      ok: false, message: 'plan correction was cancelled'
    });
    store.get.mockImplementationOnce(get).mockImplementationOnce(async (id: string) => ({ ...(await get(id)), status: 'approved' }));
    await expect(service.authorizeRegistration(ctx.executionId, submitted, ctx)).resolves.toEqual({
      ok: false, message: 'corrected plan changed after approval; renewed approval is required'
    });
    expect(records.get(ctx.executionId).status).toBe('correction-required');
  });

  it('an approve whose captured snapshot vanished asks the coordinator to resubmit instead of approving', async () => {
    const { service, bindInboxAction, records, wakeCoordinator, resume } = create();
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.authorizeRegistration(ctx.executionId, submitted, ctx);
    const record = records.get(ctx.executionId);
    delete record.offeredUnits;
    await expect(service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction))).resolves.toBe('wait');
    expect(resume).not.toHaveBeenCalled();
    expect(records.get(ctx.executionId)).toMatchObject({ status: 'correction-required' });
    expect(wakeCoordinator.mock.calls.at(-1)![1]).toContain('execution.plan.register');
  });
});

describe('lost correction wake escalation', () => {
  type Confirmation = { isCurrent(): Promise<boolean>; onUnconsumed(): Promise<void> | void };
  const lastConfirmation = (wakeCoordinator: ReturnType<typeof vi.fn>) =>
    (wakeCoordinator.mock.calls.at(-1) as unknown as [string, string, Confirmation])[2];

  async function requested() {
    const created = create();
    // No corrected plan yet: the first card is the bare "request changes" offer.
    created.readCorrectedPlan.mockResolvedValue({ status: 'missing' } as never);
    await created.service.begin(ctx.executionId, 'bad plan', false);
    await created.service.reviewInvalid(ctx);
    await created.service.respond(ctx.executionId, 'changes', latestOffer(created.bindInboxAction));
    return { ...created, confirmation: lastConfirmation(created.wakeCoordinator) };
  }

  it('fences the wake to the request that sent it', async () => {
    const { service, bindInboxAction, confirmation } = await requested();
    await expect(confirmation.isCurrent()).resolves.toBe(true);
    // A newer offer (here: the coordinator stalled and a new card was published) supersedes it.
    await service.reviewInvalid(ctx);
    await service.reviewInvalid(ctx);
    expect(latestOffer(bindInboxAction).offerId).toBeDefined();
    await expect(confirmation.isCurrent()).resolves.toBe(false);
  });

  it('is no longer current after cancel', async () => {
    const { service, bindInboxAction, confirmation, records } = await requested();
    const record = records.get(ctx.executionId);
    records.set(ctx.executionId, { ...record, status: 'pending' });
    await service.respond(ctx.executionId, 'cancel', latestOffer(bindInboxAction));
    await expect(confirmation.isCurrent()).resolves.toBe(false);
    await confirmation.onUnconsumed();
    expect(records.get(ctx.executionId)).toMatchObject({ status: 'cancelled' });
  });

  it('raises a stall card naming the lost request once the redelivery also went unconsumed', async () => {
    const { appendInbox, confirmation, records } = await requested();
    const cards = appendInbox.mock.calls.length;
    await confirmation.onUnconsumed();
    expect(appendInbox).toHaveBeenCalledTimes(cards + 1);
    expect(appendInbox.mock.calls.at(-1)![0].comments).toMatch(/^The coordinator did not pick up the correction request: it stayed idle after the request was delivered twice\. Plan requires revisions/);
    expect(records.get(ctx.executionId)).toMatchObject({ status: 'pending', retries: 2 });
    // The escalation consumed the request: a duplicate signal adds nothing.
    await confirmation.onUnconsumed();
    expect(appendInbox).toHaveBeenCalledTimes(cards + 1);
  });

  it('names the lost request above a still-reviewable register-channel proposal', async () => {
    const { service, appendInbox, bindInboxAction, wakeCoordinator } = create();
    const submitted = [{ id: 'fixed', title: 'Fixed', task: 'fixed', dependencies: [], files: ['out.txt'], verification: ['check'] }];
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.authorizeRegistration(ctx.executionId, submitted, ctx);
    await service.respond(ctx.executionId, 'changes', latestOffer(bindInboxAction));
    await lastConfirmation(wakeCoordinator).onUnconsumed();
    const card = appendInbox.mock.calls.at(-1)![0];
    expect(card.comments).toMatch(/^The coordinator did not pick up the correction request.*Problem with the supplied plan: bad plan/s);
    expect(card.questions[0].options.map((option: { id: string }) => option.id)).toEqual(['approve', 'changes', 'cancel']);
  });

  it('logs instead of carding when the review budget is spent', async () => {
    const { service, appendInbox, confirmation, records } = await requested();
    const logWarning = vi.fn();
    (service as unknown as { deps: { logWarning: typeof logWarning } }).deps.logWarning = logWarning;
    records.set(ctx.executionId, { ...records.get(ctx.executionId), retries: PLAN_CORRECTION_MAX_RETRIES });
    const cards = appendInbox.mock.calls.length;
    await confirmation.onUnconsumed();
    expect(appendInbox).toHaveBeenCalledTimes(cards);
    expect(logWarning).toHaveBeenCalledWith(ctx.executionId, expect.stringContaining('did not pick up the correction request'), undefined);
  });

  it('fences invalid-plan feedback wakes the same way', async () => {
    const { service, readCorrectedPlan, wakeCoordinator } = await requested();
    readCorrectedPlan.mockResolvedValue({ status: 'invalid', reason: 'no steps' } as never);
    await service.reviewInvalid(ctx);
    expect(wakeCoordinator.mock.calls.at(-1)![1]).toContain('is still invalid');
    await expect(lastConfirmation(wakeCoordinator).isCurrent()).resolves.toBe(true);
  });

  it('marks an approved register-channel snapshot as not file-backed', async () => {
    const { service, bindInboxAction } = create();
    const submitted = [{ id: 'fixed', title: 'Fixed', task: 'fixed', dependencies: [], files: ['out.txt'], verification: ['check'] }];
    await service.begin(ctx.executionId, 'bad plan', false);
    await service.authorizeRegistration(ctx.executionId, submitted, ctx);
    await service.respond(ctx.executionId, 'approve', latestOffer(bindInboxAction));
    await expect(service.approvedPlan(ctx.executionId)).resolves.toMatchObject({ origin: 'register' });
  });
});
