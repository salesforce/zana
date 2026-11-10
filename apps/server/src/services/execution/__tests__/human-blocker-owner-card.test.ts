import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SquadExecutionService } from '../service.js';
import { createExecutionStore } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';

// Acceptance tests for #692: the coordinator's denial names the owner's Inbox card.

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-human-blocker-card-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const request = {
  version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release\nignored',
  slots: [{ initialTask: 'Run tests' }]
};
const coordinator = { executionId: 'execution-1', projectId: 'project-1', slotId: 'orchestrator:lead', role: 'orchestrator' as const };
const workerBinding = { ...coordinator, slotId: 'slot-1', role: 'worker' as const };

async function setup(filePath: string, inbox: { append: (i: never) => Promise<{ id: string }>; appendOnce?: (i: never) => Promise<{ id: string }> }) {
  const store = createExecutionStore({ filePath, id: () => 'execution-1' });
  const service = new SquadExecutionService({
    store,
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: { teamId: 'team-1', projectId: 'project-1', slots: [], context: {
      version: 1 as const, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [
        { slotId: 'orchestrator:lead', personaId: 'lead', authorizationIdDigest: 'lead-d' },
        { slotId: 'slot-1', personaId: 'worker', authorizationIdDigest: 'w1-d' }
      ] } } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ orchestratorSessionId: 'coordinator', workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1' }] }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }),
    replyToSession: () => true,
    resolveExactNativeRecoverySnapshots: (record) => record.nativeRecoverySnapshots ?? [],
    deliverToWorker: () => true,
    inbox: inbox as never
  });
  await service.start('owner', 'project-1', { ...request, coordinationMode: 'job-team', workUnits: [{ id: 'a', title: 'A', task: 'do a', dependencies: [], files: ['a.txt'], verification: ['check a'] }] });
  await service.dispatchReady(coordinator);
  return { service, store };
}

describe('coordinator denial for a human blocker names the owner Inbox card (#692)', () => {
  it('REQ-1 REQ-2: stays denied, resolves nothing, and names the card subject and Inbox entry id once acknowledged', async () => fixture(async (filePath) => {
    const appendOnce = vi.fn(async () => ({ id: 'inbox-7' }));
    const { service, store } = await setup(filePath, { append: vi.fn(async () => ({ id: 'fallback' })), appendOnce });
    await service.blockWork(workerBinding, 'a', { id: 'blocker', question: 'Need a human decision?' });
    await vi.waitFor(async () => expect((await store.get('execution-1'))?.noticeIntents?.[0]).toMatchObject({ status: 'ACKNOWLEDGED', inboxItemId: 'inbox-7' }));

    const denied = await service.answerBlockerByCoordinator(coordinator, 'blocker', 'my decision');

    expect(denied).toMatchObject({ ok: false, code: 'DENIED' });
    const message = (denied as { message: string }).message;
    expect(message.startsWith('blocker requires owner resolution')).toBe(true);
    expect(message).toContain('"Build release"');
    expect(message).toContain('inbox-7');
    expect(message).toContain('do not retry');
    const after = (await store.get('execution-1'))!;
    expect(after.deliveries ?? []).toEqual([]);
    expect(after.blockers?.[0]).toMatchObject({ id: 'blocker', resolved: false });
  }));

  it('REQ-3: before the card exists the denial names the blocker id and says the card will appear', async () => fixture(async (filePath) => {
    const appendOnce = vi.fn(async () => { throw new Error('inbox offline'); });
    const { service, store } = await setup(filePath, { append: vi.fn(async () => { throw new Error('inbox offline'); }), appendOnce });
    await service.blockWork(workerBinding, 'a', { id: 'blocker', question: 'Need a human decision?' });
    await vi.waitFor(async () => expect((await store.get('execution-1'))?.noticeIntents?.[0]?.status).toBe('PENDING'));

    const denied = await service.answerBlockerByCoordinator(coordinator, 'blocker', 'my decision');

    expect(denied).toMatchObject({ ok: false, code: 'DENIED' });
    const message = (denied as { message: string }).message;
    expect(message.startsWith('blocker requires owner resolution')).toBe(true);
    expect(message).toContain('blocker blocker');
    expect(message).toContain('once its card appears');
    expect((await store.get('execution-1'))?.deliveries ?? []).toEqual([]);
  }));

  it('REQ-2: the denial quotes the exact subject the Inbox card was created with', async () => fixture(async (filePath) => {
    const appendOnce = vi.fn(async () => ({ id: 'inbox-9' }));
    const { service, store } = await setup(filePath, { append: vi.fn(async () => ({ id: 'f' })), appendOnce });
    await service.blockWork(workerBinding, 'a', { id: 'blocker', question: 'Q?' });
    await vi.waitFor(async () => expect((await store.get('execution-1'))?.noticeIntents?.[0]?.status).toBe('ACKNOWLEDGED'));
    const subject = (appendOnce.mock.calls[0] as unknown as [{ subject: string }])[0].subject;

    const denied = await service.answerBlockerByCoordinator(coordinator, 'blocker', 'x');

    expect((denied as { message: string }).message).toContain(`"${subject}"`);
  }));

  it('REQ-4: a coordinator-audience blocker is answered exactly as before', async () => fixture(async (filePath) => {
    const { service, store } = await setup(filePath, { append: vi.fn(async () => ({ id: 'f' })) });
    await service.blockWork(workerBinding, 'a', { id: 'blocker', question: 'Which file?', audience: 'coordinator' });

    const answered = await service.answerBlockerByCoordinator(coordinator, 'blocker', 'Write to a.txt.');

    expect(answered).toMatchObject({ ok: true, pending: true });
    expect((await store.get('execution-1'))?.deliveries).toEqual([expect.objectContaining({ slotId: 'slot-1', blockerId: 'blocker', state: 'PENDING', payload: { text: 'Write to a.txt.' } })]);
  }));

  it('REQ-1: a non-orchestrator caller keeps the old role denial, not the owner-card text', async () => fixture(async (filePath) => {
    const { service } = await setup(filePath, { append: vi.fn(async () => ({ id: 'f' })) });
    await service.blockWork(workerBinding, 'a', { id: 'blocker', question: 'Q?' });
    const denied = await service.answerBlockerByCoordinator(workerBinding, 'blocker', 'x');
    expect(denied).toMatchObject({ ok: false, code: 'DENIED', message: expect.stringContaining('only coordinator') });
  }));
});

describe('correctness obligations (OBL-009, OBL-005)', () => {
  it('OBL-009 REQ-4: re-issuing a coordinator-audience answer replays one delivery', async () => fixture(async (filePath) => {
    const { service, store } = await setup(filePath, { append: vi.fn(async () => ({ id: 'f' })) });
    await service.blockWork(workerBinding, 'a', { id: 'blocker', question: 'Which file?', audience: 'coordinator' });
    const first = await service.answerBlockerByCoordinator(coordinator, 'blocker', 'Write to a.txt.');
    const replay = await service.answerBlockerByCoordinator(coordinator, 'blocker', 'Write to a.txt.');
    expect(first).toMatchObject({ ok: true });
    expect(replay).toMatchObject({ ok: true });
    const deliveries = (await store.get('execution-1'))?.deliveries;
    expect(deliveries).toHaveLength(1);
    expect(deliveries?.[0]?.clientRequestId).toBe('execution-1:blocker:coordinator-answer');
  }));

  it('OBL-005 REQ-1: repeated coordinator attempts on a human blocker stay denied and enqueue nothing', async () => fixture(async (filePath) => {
    const { service, store } = await setup(filePath, { append: vi.fn(async () => ({ id: 'f' })), appendOnce: vi.fn(async () => ({ id: 'inbox-3' })) });
    await service.blockWork(workerBinding, 'a', { id: 'blocker', question: 'Q?' });
    await vi.waitFor(async () => expect((await store.get('execution-1'))?.noticeIntents?.[0]?.status).toBe('ACKNOWLEDGED'));
    for (let i = 0; i < 2; i += 1) {
      expect(await service.answerBlockerByCoordinator(coordinator, 'blocker', 'x')).toMatchObject({ ok: false, code: 'DENIED' });
    }
    const after = (await store.get('execution-1'))!;
    expect(after.deliveries ?? []).toEqual([]);
    expect(after.blockers?.[0]?.resolved).toBe(false);
  }));
});
