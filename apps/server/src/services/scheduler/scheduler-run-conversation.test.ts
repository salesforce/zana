import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/cc-test-home' } }));
vi.mock('./scheduler-store.js', () => ({
  readSchedule: vi.fn((task) => structuredClone(task)), saveSchedule: vi.fn(),
  deleteSchedule: vi.fn(() => true),
  listAllSchedules: vi.fn(() => []),
  globalDir: () => '/tmp/cc-test-home/.zcc/schedules',
  projectDir: (project: { path: string }) => `${project.path}/.zcc/schedules`
}));
vi.mock('../claude.js', () => ({ listClaudeSessions: vi.fn(() => []) }));

import { SchedulerManager } from './scheduler.js';
import { readSchedule } from './scheduler-store.js';
import type { PtyManager } from '@zana-ai/zcc-host-daemon/pty';
import type { Persona, Project } from '@zana-ai/zcc-domain/product';

interface FakeSession {
  id: string; projectId: string; title: string; profile: string; cwd: string;
  status: 'running' | 'exited'; createdAt: number; extraArgs?: string[];
  claudeSessionId?: string; codexSessionId?: string;
}

/** Sessions carry what the real pty stamps: the remapped profile, cwd, extraArgs, createdAt and a minted claude id. */
class FakePtyManager extends EventEmitter {
  sessions: FakeSession[] = [];
  list(projectId: string) { return this.sessions.filter((s) => s.projectId === projectId); }
  reapDeadSessions(): string[] { return []; }
  create(opts: Record<string, unknown>) {
    const session: FakeSession = {
      id: (opts.preallocatedSessionId as string) ?? `pty-${this.sessions.length + 1}`,
      projectId: opts.projectId as string,
      title: 'x',
      profile: opts.profile as string,
      cwd: '/tmp/proj',
      status: 'running',
      createdAt: Date.parse('2026-10-27T10:00:00.000Z'),
      extraArgs: opts.extraArgs as string[] | undefined,
      ...(String(opts.profile).startsWith('claude') ? { claudeSessionId: 'claude-conv-1' } : {})
    };
    this.sessions.push(session);
    return session;
  }
  write() { /* no-op */ }
  closeExpected() { return true; }
  simulateExit(id: string, code = 0) {
    const session = this.sessions.find((s) => s.id === id);
    if (session) session.status = 'exited';
    this.emit('exit', id, code);
  }
}

async function makeManager(taskFields: Record<string, unknown> = {}, deps: Record<string, unknown> = {}) {
  const ptys = new FakePtyManager();
  const project: Project = { id: 'proj-1', name: 'P', path: '/tmp/proj', createdAt: 0, lastActiveAt: 0 };
  const manager = new SchedulerManager();
  manager.setDeps({
    ptys: ptys as unknown as PtyManager,
    launchTerminal: (opts) => ptys.create(opts as unknown as Record<string, unknown>) as never,
    store: { listProjects: () => [project], getConfig: () => ({}) } as unknown as Parameters<SchedulerManager['setDeps']>[0]['store'],
    getPendingSubagentCount: () => 0,
    ...deps
  });
  const task = await manager.create({
    name: 't', projectId: 'proj-1', profile: 'claude', every: '5m', enabled: false, inboxLevel: 'silent', ...taskFields
  } as never);
  return { manager, ptys, task };
}

/** `create()` doesn't carry a persona, so a persona schedule arrives the way a hand-edited file does: through the fire-time reread. */
async function makePersonaManager(baseProfile: string) {
  const resolvePersona = vi.fn(() => ({ id: 'p', baseProfile }) as unknown as Persona);
  vi.mocked(readSchedule).mockImplementation(((task: Record<string, unknown>) => ({ ...structuredClone(task), personaId: 'p' })) as never);
  return makeManager({ prompt: 'hi' }, { resolvePersona });
}

const runsOf = (manager: SchedulerManager, id: string) => manager.list().find((t) => t.id === id)!.status.runs;

describe('SchedulerManager run conversation', () => {
  afterEach(() => { vi.mocked(readSchedule).mockImplementation(((task: unknown) => structuredClone(task)) as never); });

  it('records a claude run\'s conversation at launch and keeps it through exit', async () => {
    const { manager, ptys, task } = await makeManager({ prompt: 'hello' });
    await manager.runNow(task.id);
    expect(runsOf(manager, task.id)[0]!.conversation).toEqual({
      profile: 'claude', id: 'claude-conv-1', cwd: '/tmp/proj', startedAt: '2026-10-27T10:00:00.000Z'
    });
    ptys.simulateExit(ptys.sessions[0]!.id, 0);
    await vi.waitFor(() => expect(runsOf(manager, task.id)[0]!.durationMs).toBeDefined());
    expect(runsOf(manager, task.id)[0]!.conversation).toMatchObject({ profile: 'claude', id: 'claude-conv-1' });
  });

  it('takes the profile from the persona\'s baseProfile, not the remapped session profile', async () => {
    const { manager, ptys, task } = await makePersonaManager('codex');
    await manager.runNow(task.id);
        expect(runsOf(manager, task.id)[0]!.conversation?.profile).toBe('codex');
  });

  it('records a detected-id harness without an id, and the exit handler fills it in', async () => {
    const { manager, ptys, task } = await makePersonaManager('codex');
    await manager.runNow(task.id);
    const conversation = runsOf(manager, task.id)[0]!.conversation!;
    expect(conversation).toMatchObject({ profile: 'codex', cwd: '/tmp/proj' });
    expect(conversation.id).toBeUndefined();
    ptys.sessions[0]!.codexSessionId = 'codex-conv-9';
    ptys.simulateExit(ptys.sessions[0]!.id, 0);
    await vi.waitFor(() => expect(runsOf(manager, task.id)[0]!.conversation?.id).toBe('codex-conv-9'));
    expect(runsOf(manager, task.id)[0]!.conversation?.startedAt).toBe('2026-10-27T10:00:00.000Z');
  });

  it('leaves the id absent at exit when the harness never resolved one', async () => {
    const { manager, ptys, task } = await makePersonaManager('codex');
    await manager.runNow(task.id);
    ptys.simulateExit(ptys.sessions[0]!.id, 0);
    await vi.waitFor(() => expect(runsOf(manager, task.id)[0]!.durationMs).toBeDefined());
    expect(runsOf(manager, task.id)[0]!.conversation).toBeDefined();
    expect(runsOf(manager, task.id)[0]!.conversation?.id).toBeUndefined();
  });

  it('records nothing for a harness that can neither mint nor detect an id', async () => {
    const { manager, task } = await makeManager({ profile: 'afcode', prompt: 'hi' });
    await manager.runNow(task.id);
    expect(runsOf(manager, task.id)[0]).toBeDefined();
    expect(runsOf(manager, task.id)[0]!.conversation).toBeUndefined();
  });

  it('records nothing for a shell schedule', async () => {
    const { manager, task } = await makeManager({ profile: 'shell', prompt: 'echo hi' });
    await manager.runNow(task.id);
    expect(runsOf(manager, task.id)[0]).toBeDefined();
    expect(runsOf(manager, task.id)[0]!.conversation).toBeUndefined();
  });

  it('records nothing for a Squad run', async () => {
    const launchSquad = vi.fn(async () => ({ executionId: 'execution-1' }));
    const { manager, task } = await makeManager({ kind: 'team', teamId: 'release', prompt: 'ship' }, { launchSquad });
    await manager.runNow(task.id);
    expect(runsOf(manager, task.id)[0]).toMatchObject({ executionId: 'execution-1' });
    expect(runsOf(manager, task.id)[0]!.conversation).toBeUndefined();
  });

  it('does not treat a reopened tab (a pty id that is no run\'s sessionId) as a run, report target, finish or overlap', async () => {
    const { manager, ptys, task } = await makeManager({ prompt: 'hi' });
    await manager.runNow(task.id);
    const runSession = ptys.sessions[0]!.id;
    ptys.simulateExit(runSession, 0);
    await vi.waitFor(() => expect(runsOf(manager, task.id)[0]!.durationMs).toBeDefined());
    const before = structuredClone(runsOf(manager, task.id));

    // History-style resume: a live tab on the same conversation under a fresh pty id.
    ptys.sessions.push({ id: 'reopened-1', projectId: 'proj-1', title: '↺ t', profile: 'claude', cwd: '/tmp/proj', status: 'running', createdAt: Date.now(), claudeSessionId: 'claude-conv-1' });
    await manager.attachReport('reopened-1', 'late report', 'success');
    await manager.onAgentFinished('reopened-1');
    expect(runsOf(manager, task.id)).toEqual(before);

    // An AUTO fire runs the overlap guard (a manual `runNow` would bypass it): the
    // live reopened tab must not count as this schedule's run still going.
    const spawned = ptys.sessions.length;
    await (manager as unknown as { fire: (id: string, opts: { manual: boolean }) => Promise<void> }).fire(task.id, { manual: false });
    expect(ptys.sessions, 'the auto fire spawned a new run').toHaveLength(spawned + 1);
    const runs = runsOf(manager, task.id);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.result).not.toBe('skipped');
    expect(runs[0]!.reasonCode).toBeUndefined();
  });
});
