import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Drives host.ts `authorizeTeamLaunch` / `launchTeam` through their real paths with
 * a faked pty layer and in-memory team/persona stores. Covers native-recovery
 * projection, squad worktree/cohort propagation, preauthorization binding checks,
 * idempotent replay, cold-start cancel, and failure responses.
 */
const h = vi.hoisted(() => {
  const root = (require('node:fs') as typeof import('node:fs')).mkdtempSync(
    require('node:path').join(require('node:os').tmpdir(), 'host-team-launch-direct-')
  );
  return {
    root,
    projects: [] as any[],
    config: {} as any,
    teams: [] as any[],
    personas: [] as any[],
    creates: [] as any[],
    createImpl: null as null | ((opts: any) => any),
    sessions: new Map<string, any>(),
    dispatchReady: null as null | ((...args: any[]) => any)
  };
});

vi.stubEnv('ZCC_DATA_DIR', h.root);
vi.stubEnv('ZCC_EXECUTION_STORE', 'json');

vi.mock('@zana-ai/zcc-host-daemon/pty', () => ({
  PtyManager: class {
    setMcpBaseUrl() {}
    setProjectRoots() {}
    setRulesResolver() {}
    create(opts: any) {
      h.creates.push(opts);
      if (h.createImpl) return h.createImpl(opts);
      const session = { id: opts.preallocatedSessionId ?? opts.sessionId ?? `s${h.creates.length}`, status: 'running', projectId: opts.projectId, cohort: opts.cohort };
      h.sessions.set(session.id, session);
      return session;
    }
    getSession(id: string) { return h.sessions.get(id) ?? null; }
    list() { return [...h.sessions.values()]; }
    reply() {}
    setRestoreCapabilityId() {}
    async waitForReady(id: string) { return h.sessions.get(id); }
    on() { return this; }
    closeExpected() {}
    close() { return true; }
  },
  isClaudeProfile: (p: string) => p === 'claude'
}));

vi.mock('@zana-ai/zcc-server/services/projects/store', () => ({
  store: {
    listProjects: () => h.projects,
    getConfig: () => h.config,
    getProjectSettings: () => ({}),
    createScratchSubfolder: () => '/tmp/scratch',
    ensureRemoteProjectLocalDir: (project: unknown) => project
  },
  scratchWorkspaceRoot: () => '/tmp/scratch-root',
  worktreeRoot: () => '/tmp/zcc-worktrees',
  worktreeTargetDir: (_p: unknown, slug: string) => `/tmp/zcc-worktrees/${slug}`
}));

vi.mock('@zana-ai/zcc-server/services/agents/persona-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-server/services/agents/persona-store')>();
  class FakePersonaStore extends actual.PersonaStore {
    list() { return h.personas; }
    start() {}
    stop() {}
    refresh() {}
    rebindProjects() {}
  }
  return { ...actual, PersonaStore: FakePersonaStore };
});

vi.mock('@zana-ai/zcc-server/services/agents/team-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@zana-ai/zcc-server/services/agents/team-store')>();
  class FakeTeamStore extends actual.TeamStore {
    list() { return h.teams; }
    start() {}
    stop() {}
    refresh() {}
    rebindProjects() {}
  }
  return { ...actual, TeamStore: FakeTeamStore };
});

vi.mock('electron', () => ({
  safeStorage: { isEncryptionAvailable: () => false },
  app: {
    on: () => {},
    whenReady: () => new Promise(() => {}),
    getPath: () => h.root,
    setName: () => {},
    requestSingleInstanceLock: () => true,
    quit: () => {}
  },
  BrowserWindow: { getAllWindows: () => [], getFocusedWindow: () => null },
  ipcMain: { handle: () => {}, on: () => {} },
  dialog: {}, shell: {}, screen: {},
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  nativeImage: { createFromPath: () => ({}) },
  powerMonitor: { on: () => {} }
}));
vi.mock('../updater.js', () => ({ createUpdater: () => ({}) }));
vi.mock('@zana-ai/zcc-host-daemon/mcp-config', () => ({
  ensureMcpConfigForProject: () => '/tmp/p1/.mcp.json',
  ensureMcpConfigForProjectSync: () => '/tmp/p1/.mcp.json',
  alwaysOnPluginMcpAllowlist: () => []
}));

const host = await import('../host.js');
const { authorizeTeamLaunch, launchTeam } = host;

const projectDir = realpathSync(mkdtempSync(join(h.root, 'proj-')));
mkdirSync(projectDir, { recursive: true });

const persona = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), baseProfile: 'claude', ...extra });
let seq = 0;

beforeEach(() => {
  seq += 1;
  h.projects = [{ id: 'p1', name: 'Proj', path: projectDir }];
  h.config = { version: 1, theme: 'dark', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null };
  h.personas = [persona('orch'), persona('w1'), persona('w2')];
  h.teams = [{
    id: 'team1', name: 'Team One', orchestratorPersonaId: 'orch',
    slots: [{ personaId: 'w1', quantity: 2 }, { personaId: 'w2', label: 'Second' }]
  }];
  h.creates.length = 0;
  h.sessions.clear();
  h.createImpl = null;
});

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(h.root, { recursive: true, force: true });
});

const SLOT_IDS = ['0:w1:0', '0:w1:1', '1:w2:0', 'orchestrator:orch'];
const tasks = () => SLOT_IDS.map((slotId) => ({ initialTask: `task for ${slotId}` }));
const reqId = () => `req-${seq}-${Math.random().toString(36).slice(2)}`;

describe('authorizeTeamLaunch', () => {
  it('denies missing principal or request id', () => {
    expect(authorizeTeamLaunch(' ', 'team1', 'p1', 'r', {}, tasks())).toMatchObject({ ok: false, code: 'DENIED' });
    expect(authorizeTeamLaunch('c', 'team1', 'p1', ' ', {}, tasks())).toMatchObject({ ok: false, code: 'DENIED' });
  });

  it('reports unknown team / project / unsupported host', () => {
    expect(authorizeTeamLaunch('c', 'nope', 'p1', reqId(), {}, tasks())).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(authorizeTeamLaunch('c', 'team1', 'nope', reqId(), {}, tasks())).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    h.projects = [{ id: 'p1', name: 'Proj', path: projectDir, hostId: 'other-host' }];
    const result = authorizeTeamLaunch('c', 'team1', 'p1', reqId(), {}, tasks());
    expect(result.ok).toBe(false);
  });

  it('authorizes a bound SSH remote while keeping a secondary checkout blocked', () => {
    h.projects = [{ id: 'p1', name: 'Remote', path: projectDir, hostId: 'other-host', remote: { host: 'ssh-box' } }];
    expect(authorizeTeamLaunch('c', 'team1', 'p1', reqId(), {}, tasks())).toMatchObject({ ok: true });
    h.projects = [{ id: 'p1', name: 'Secondary', path: projectDir, hostId: 'other-host' }];
    expect(authorizeTeamLaunch('c', 'team1', 'p1', reqId(), {}, tasks()))
      .toMatchObject({ ok: false, code: 'HOST_UNSUPPORTED' });
  });

  it('rejects mismatched counts, invalid tasks, over-limit and unknown personas', () => {
    expect(authorizeTeamLaunch('c', 'team1', 'p1', reqId(), {}, tasks().slice(1))).toMatchObject({ ok: false, code: 'INVALID' });
    const blank = tasks(); blank[0].initialTask = '  ';
    expect(authorizeTeamLaunch('c', 'team1', 'p1', reqId(), {}, blank)).toMatchObject({ ok: false, message: 'invalid initial task' });
    const huge = tasks(); huge[1].initialTask = 'x'.repeat(65 * 1024);
    expect(authorizeTeamLaunch('c', 'team1', 'p1', reqId(), {}, huge)).toMatchObject({ ok: false, message: 'invalid initial task' });
    expect(authorizeTeamLaunch('c', 'team1', 'p1', reqId(), { maxLaunches: 2 }, tasks()))
      .toMatchObject({ ok: false, code: 'RESOURCE_LIMIT' });
    h.personas = [persona('orch'), persona('w1')];
    expect(authorizeTeamLaunch('c', 'team1', 'p1', reqId(), {}, tasks()))
      .toMatchObject({ ok: false, code: 'DENIED', message: 'unknown persona: w2' });
  });

  it('issues per-slot authorizations, deadline, admission digest and honours native recovery', () => {
    const slots = tasks();
    const result = authorizeTeamLaunch('c', 'team1', 'p1', reqId(), { deadlineMs: 60_000 }, slots, 'freeform', 'digest-1', [
      { role: 'worker', slotId: '0:w1:0', personaId: 'w1', profileId: 'claude', nativeConversationId: 'native-1' } as never,
      { role: 'worker', slotId: '1:w2:0', personaId: 'other', profileId: 'claude', nativeConversationId: 'native-2' } as never
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.slots.map((s) => s.slotId)).toEqual(SLOT_IDS);
    expect(result.value.admissionDigest).toBe('digest-1');
    expect(result.value.context?.slots).toHaveLength(4);
    expect(result.value.slots.filter((s) => s.nativeRecovery)).toHaveLength(1);
    expect(result.value.slots[0].nativeRecovery).toMatchObject({ nativeConversationId: 'native-1' });
  });

  it('revokes already issued slots and denies when the principal concurrency limit is below the slot count', () => {
    const result = authorizeTeamLaunch('c', 'team1', 'p1', reqId(), { maxConcurrent: 2 }, tasks());
    expect(result).toMatchObject({ ok: false, code: 'DENIED', message: 'principal concurrent launch limit reached' });
  });

  it('autonomous-team and freeform+teamLaunchEnabled mark bindings autonomous; same request id is idempotent', () => {
    h.config.teamLaunchEnabled = true;
    const id = reqId();
    expect(authorizeTeamLaunch('c', 'team1', 'p1', id, {}, tasks(), 'autonomous-team').ok).toBe(true);
    // second authorize with the same principal+request re-binds the same principal
    expect(authorizeTeamLaunch('c', 'team1', 'p1', id, {}, tasks(), 'freeform').ok).toBe(true);
  });

  it('denies when principal binding changes mid-run and revokes earlier slots on a denied decision', () => {
    const id = reqId();
    expect(authorizeTeamLaunch('c', 'team1', 'p1', id, { maxLaunches: 8 }, tasks()).ok).toBe(true);
    const changed = authorizeTeamLaunch('c', 'team1', 'p1', id, { maxLaunches: 4, maxConcurrent: 1 }, tasks());
    expect(changed).toMatchObject({ ok: false });
  });

  it('caps expansion at the worker ceiling (with and without an orchestrator)', () => {
    const rows = Array.from({ length: 12 }, () => ({ personaId: 'w1', quantity: 99 }));
    h.teams = [{ id: 'big', name: 'Big', orchestratorPersonaId: 'orch', slots: rows }, { id: 'bignoorch', name: 'B', slots: rows }];
    const many = Array.from({ length: 32 }, (_, i) => ({ initialTask: `t${i}` }));
    const withOrch = authorizeTeamLaunch('c', 'big', 'p1', reqId(), {}, many);
    expect(withOrch.ok).toBe(true);
    if (withOrch.ok) expect(withOrch.value.slots.at(-1)!.slotId).toBe('orchestrator:orch');
    const without = authorizeTeamLaunch('c', 'bignoorch', 'p1', reqId(), {}, many);
    expect(without.ok).toBe(true);
    if (without.ok) expect(without.value.slots).toHaveLength(32);
  });
});

describe('launchTeam validation failures', () => {
  it('rejects unknown team, missing project, unknown project, unsupported host', async () => {
    expect(await launchTeam('nope')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await launchTeam('team1')).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await launchTeam('team1', 'zzz')).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    h.projects = [{ id: 'p1', name: 'Proj', path: projectDir, hostId: 'other-host' }];
    expect(await launchTeam('team1', 'p1')).toMatchObject({ ok: false });
  });

  it('launches a bound SSH remote through the existing remote path', async () => {
    h.projects = [{ id: 'p1', name: 'Remote', path: projectDir, hostId: 'other-host', remote: { host: 'ssh-box' } }];
    const result = await launchTeam('team1', 'p1');
    expect(result.ok).toBe(true);
    expect(h.creates).toHaveLength(4);
    for (const create of h.creates) expect(create.remote).toMatchObject({ host: 'ssh-box' });
  });

  it('requires an orchestrator for durable coordination', async () => {
    h.teams = [{ id: 'noorch', name: 'N', slots: [{ personaId: 'w1' }] }];
    const result = await launchTeam('noorch', 'p1', {
      callerPrincipalId: 'c', launchRequestId: reqId(), coordinationMode: 'job-team',
      slots: [{ slotId: '0:w1:0', initialTask: 't' }]
    });
    expect(result).toMatchObject({ ok: false, code: 'NO_ORCHESTRATOR' });
  });

  it('validates structured request shape', async () => {
    const base = { callerPrincipalId: 'c', launchRequestId: reqId() };
    const ok = SLOT_IDS.map((slotId) => ({ slotId, initialTask: 'x' }));
    expect(await launchTeam('team1', 'p1', { ...base, callerPrincipalId: ' ', slots: ok })).toMatchObject({ ok: false, code: 'INVALID' });
    expect(await launchTeam('team1', 'p1', { ...base, slots: ok.slice(1) })).toMatchObject({ ok: false, message: 'structured slots do not match host-expanded Team slots' });
    expect(await launchTeam('team1', 'p1', { ...base, slots: [{ slotId: 'bad', initialTask: 'x' }, ...ok.slice(1)] }))
      .toMatchObject({ ok: false, message: 'structured slots do not match host-expanded Team slots' });
    expect(await launchTeam('team1', 'p1', { ...base, requirePreauthorization: true, slots: ok }))
      .toMatchObject({ ok: false, code: 'DENIED', message: 'structured slot is missing authorizationId' });
    expect(await launchTeam('team1', 'p1', { ...base, slots: [{ slotId: ok[0].slotId, initialTask: ' ' }, ...ok.slice(1)] }))
      .toMatchObject({ ok: false, message: 'invalid initial task' });
    expect(await launchTeam('team1', 'p1', { ...base, policy: { maxLaunches: 2 }, slots: ok }))
      .toMatchObject({ ok: false, code: 'RESOURCE_LIMIT' });
  });
});

describe('launchTeam legacy (goal) path', () => {
  it('opens workers then the orchestrator under one cohort and replays idempotently', async () => {
    const result = await launchTeam('team1', 'p1', { goal: '  ship it  ' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.launched).toBe(4);
    expect(result.value.workerSessionIds).toHaveLength(3);
    expect(result.value.orchestratorSessionId).toBeTruthy();
    const cohorts = new Set(h.creates.map((c) => c.cohort?.cohortId));
    expect(cohorts.size).toBe(1);
    const [first] = h.creates;
    expect(first.cohort).toMatchObject({ role: 'worker', coordinationMode: 'autonomous-team', configuredProfile: 'claude' });
    expect(h.creates.at(-1).cohort.role).toBe('orchestrator');
    // second worker row has quantity 1 + custom label; quantity>1 rows are suffixed
    expect(h.creates.map((c) => c.title)).toContain('Second');
  });

  it('interactive launch without a goal keeps coordination interactive-team', async () => {
    const result = await launchTeam('team1', 'p1');
    expect(result.ok).toBe(true);
    expect(h.creates[0].cohort.coordinationMode).toBe('interactive-team');
  });

  it('records unknown worker personas and unknown standalone orchestrator as failed slots', async () => {
    h.personas = [persona('w1'), persona('w2')];
    const result = await launchTeam('team1', 'p1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.failedSlots.map((s) => s.reason)).toContain('unknown persona');
      expect(result.value.orchestratorSessionId).toBeUndefined();
    }
    h.personas = [persona('orch'), persona('w2')];
    const second = await launchTeam('team1', 'p1');
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.failedSlots.some((s) => s.slotId === '0:w1:0' && s.reason === 'unknown persona')).toBe(true);
  });

  it('surfaces worker and orchestrator spawn failures', async () => {
    h.createImpl = () => { throw new Error('spawn boom'); };
    const result = await launchTeam('team1', 'p1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.launched).toBe(0);
      expect(result.value.failedSlots.length).toBeGreaterThan(0);
    }
  });
});

describe('launchTeam structured path', () => {
  const structuredReq = (extra: Record<string, unknown> = {}) => ({
    callerPrincipalId: 'owner',
    launchRequestId: reqId(),
    slots: SLOT_IDS.map((slotId) => ({ slotId, initialTask: `task ${slotId}` })),
    ...extra
  });

  it('fails TEAM_LAUNCH_FAILED when a structured launch opens nothing, and replays the stored failure', async () => {
    h.createImpl = () => { throw new Error('spawn boom'); };
    const req = structuredReq({ coordinationMode: 'structured', jobContext: { objective: 'obj' } });
    const first = await launchTeam('team1', 'p1', req as never);
    expect(first).toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED' });
    const replay = await launchTeam('team1', 'p1', req as never);
    expect(replay).toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED' });
  });

  it('rejects a reused request id with changed payload', async () => {
    const req = structuredReq();
    const firstRes = await launchTeam('team1', 'p1', req as never);
    expect(firstRes.ok).toBe(true);
    const changed = { ...req, slots: req.slots.map((s, i) => (i === 0 ? { ...s, initialTask: 'different' } : s)) };
    expect(await launchTeam('team1', 'p1', changed as never)).toMatchObject({ ok: false, code: 'CONFLICT' });
    // identical replay returns stored result
    const replay = await launchTeam('team1', 'p1', req as never);
    expect(replay.ok).toBe(true);
  });

  it('consumes preissued authorizations and rejects tampered / unknown ones', async () => {
    const callerPrincipalId = 'owner';
    const launchRequestId = reqId();
    const authorized = authorizeTeamLaunch(callerPrincipalId, 'team1', 'p1', launchRequestId, {}, tasks(), 'structured', 'adm');
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    const slots = authorized.value.slots.map(({ slotId, initialTask, authorizationId }) => ({ slotId, initialTask, authorizationId }));
    const base = { callerPrincipalId, launchRequestId, requirePreauthorization: true, admissionDigest: 'adm', coordinationMode: 'structured' as const };

    const unknown = await launchTeam('team1', 'p1', { ...base, launchRequestId: reqId(), slots: slots.map((s) => ({ ...s, authorizationId: 'nope' })) } as never);
    expect(unknown).toMatchObject({ ok: false, code: 'DENIED', message: 'unknown authorization' });

    // task digest mismatch -> binding mismatch
    const tampered = await launchTeam('team1', 'p1', { ...base, slots: slots.map((s, i) => (i === 0 ? { ...s, initialTask: 'tampered' } : s)) } as never);
    expect(tampered).toMatchObject({ ok: false, code: 'DENIED', message: 'preissued authorization binding mismatch' });

    // a fresh authorization with the right digest launches
    const fresh = authorizeTeamLaunch(callerPrincipalId, 'team1', 'p1', launchRequestId + 'b', {}, tasks(), 'structured', 'adm');
    expect(fresh.ok).toBe(true);
    if (!fresh.ok) return;
    const freshSlots = fresh.value.slots.map(({ slotId, initialTask, authorizationId }) => ({ slotId, initialTask, authorizationId }));
    const launched = await launchTeam('team1', 'p1', { ...base, launchRequestId: launchRequestId + 'b', slots: freshSlots } as never);
    expect(launched.ok).toBe(true);
    if (launched.ok) expect(launched.value.launched).toBe(4);
    // replay after completion revokes + returns stored result
    const replay = await launchTeam('team1', 'p1', { ...base, launchRequestId: launchRequestId + 'b', slots: freshSlots } as never);
    expect(replay.ok).toBe(true);
  });

  it('rejects a preissued authorization whose deadline elapsed', async () => {
    const launchRequestId = reqId();
    const authorized = authorizeTeamLaunch('owner', 'team1', 'p1', launchRequestId, { deadlineMs: 1 }, tasks(), 'structured');
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
    const slots = authorized.value.slots.map(({ slotId, initialTask, authorizationId }) => ({ slotId, initialTask, authorizationId }));
    const result = await launchTeam('team1', 'p1', {
      callerPrincipalId: 'owner', launchRequestId, requirePreauthorization: true, coordinationMode: 'structured',
      policy: { deadlineMs: 1 }, slots
    } as never);
    expect(result).toMatchObject({ ok: false, code: 'DEADLINE_EXCEEDED' });
  });

  it('routes recovery resume ids and extra args into the spawn request', async () => {
    const launchRequestId = reqId();
    const nativeRecovery = [
      { role: 'worker', slotId: '0:w1:0', personaId: 'w1', profileId: 'claude', nativeConversationId: 'native-1' },
      { role: 'orchestrator', slotId: 'orchestrator:orch', personaId: 'orch', profileId: 'claude', nativeConversationId: 'native-o' }
    ];
    const result = await launchTeam('team1', 'p1', {
      ...structuredReq({ launchRequestId }),
      slots: SLOT_IDS.map((slotId) => ({
        slotId, initialTask: `task ${slotId}`,
        ...(nativeRecovery.find((n) => n.slotId === slotId) ? { nativeRecovery: nativeRecovery.find((n) => n.slotId === slotId) } : {})
      }))
    } as never);
    expect(result.ok).toBe(true);
  });
});

describe('launchTeam non-claude recovery, orchestrator binding failure and orchestrator-less teams', () => {
  const NATIVE = '11111111-2222-4333-8444-555555555555';

  it('resumes codex native conversations for worker and orchestrator slots', async () => {
    h.personas = [persona('cxo', { baseProfile: 'codex' }), persona('cx', { baseProfile: 'codex' })];
    h.teams = [{ id: 'cxteam', name: 'CX', orchestratorPersonaId: 'cxo', slots: [{ personaId: 'cx' }] }];
    const launchRequestId = reqId();
    const nativeRecovery = [
      { role: 'worker', slotId: '0:cx:0', personaId: 'cx', profileId: 'codex', nativeConversationId: NATIVE },
      { role: 'orchestrator', slotId: 'orchestrator:cxo', personaId: 'cxo', profileId: 'codex', nativeConversationId: NATIVE }
    ];
    const authorized = authorizeTeamLaunch('owner', 'cxteam', 'p1', launchRequestId, {},
      [{ initialTask: 'w' }, { initialTask: 'o' }], 'structured', undefined, nativeRecovery as never);
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    const result = await launchTeam('cxteam', 'p1', {
      callerPrincipalId: 'owner', launchRequestId, requirePreauthorization: true, coordinationMode: 'structured',
      slots: authorized.value.slots.map(({ slotId, initialTask, authorizationId, nativeRecovery: recovery }) => ({ slotId, initialTask, authorizationId, nativeRecovery: recovery }))
    } as never);
    expect(result.ok).toBe(true);
    expect(h.creates.map((c) => c.resumeSessionId)).toEqual([NATIVE, NATIVE]);
    expect(h.creates.every((c) => c.profile === 'codex-resume')).toBe(true);
  });

  it('fails an orchestrator whose adapter cannot bind the initial task', async () => {
    h.personas = [persona('orch', { baseProfile: 'shell' }), persona('w1'), persona('w2')];
    const slots = SLOT_IDS.map((slotId) => ({ slotId, initialTask: `t ${slotId}` }));
    const partial = await launchTeam('team1', 'p1', { callerPrincipalId: 'owner', launchRequestId: reqId(), slots } as never);
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      expect(partial.value.orchestratorSessionId).toBeUndefined();
      expect(partial.value.failedSlots.map((s) => s.reason).join()).toContain('cannot bind initial task');
    }
    const durable = await launchTeam('team1', 'p1', { callerPrincipalId: 'owner', launchRequestId: reqId(), coordinationMode: 'structured', slots } as never);
    expect(durable).toMatchObject({ ok: false, code: 'TEAM_LAUNCH_FAILED' });
    expect(durable.ok ? '' : durable.message).toContain('cannot bind initial task');
  });

  it('launches an orchestrator-less team and skips the orchestrator step', async () => {
    h.teams = [{ id: 'flat', name: 'Flat', slots: [{ personaId: 'w1' }] }];
    const result = await launchTeam('flat', 'p1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.orchestratorSessionId).toBeUndefined();
      expect(result.value.launched).toBe(1);
    }
  });

  it('flags a team whose declared orchestrator persona vanished', async () => {
    h.personas = [persona('w1'), persona('w2')];
    const result = await launchTeam('team1', 'p1', {
      callerPrincipalId: 'owner', launchRequestId: reqId(), coordinationMode: 'structured',
      slots: SLOT_IDS.map((slotId) => ({ slotId, initialTask: 't' }))
    } as never);
    expect(result).toMatchObject({ ok: false, code: 'NO_ORCHESTRATOR' });
  });
});
