import { linkSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Persona, Team } from '@zana-ai/zcc-domain/product';
import { ExecutionSourceError } from '@zana-ai/zcc-server/services/execution/source-registry';
import { squadGoalTooLongMessage, squadSummaryTooLongMessage } from '@zana-ai/zcc-domain/squad-proposal';
import { InboxActionOperatorError } from '../inbox-actions/registry.js';
import { createSquadProposalStore } from './store.js';
import { confineSource, goalMentionPaths, goalPathNotAllowed, goalPathTokens, sourceScope, type SquadProposalFs, type SquadSourceScope } from './sources.js';
import {
  MAX_ACTIVE_NOW_RUNS_PER_SESSION,
  SQUAD_LAUNCH_PROPOSAL_ACTION,
  createSquadProposalService,
  type SquadLaunchNowDeps,
  type SquadProposalServiceDeps
} from './service.js';

let root: string;
let outside: string;
let homeDir: string;
let cloneDir: string;
let clock: number;
let ids: number;
let lookup: SquadProposalServiceDeps['lookupProposer'];
const appendOnce = vi.fn();
const bind = vi.fn();
const markUnavailable = vi.fn();
const issueSources = vi.fn();
const resolveSquadPlan = vi.fn();
const logError = vi.fn();
const realFs: SquadProposalFs = { realpath: fsp.realpath, lstat: fsp.lstat, open: fsp.open };
let fsImpl: SquadProposalFs;

const writer: Persona = { id: 'orch', name: 'Lead' } as Persona;
const reader: Persona = { id: 'ro', name: 'Planner', deniedTools: ['Write', 'Edit'] } as Persona;
let teamRecord: Team;
let personaMap: Record<string, Persona>;
let hostProblem: string | undefined;
let slotCount: number;
let projectOk: boolean;
let readFails: boolean;
let enabledFlag: boolean;
const launchApproval = vi.fn<SquadLaunchNowDeps['launchApproval']>();
const activeOwnedRuns = vi.fn<SquadLaunchNowDeps['activeOwnedRuns']>();
const executionState = vi.fn<NonNullable<SquadLaunchNowDeps['executionState']>>();
const launchNow = vi.fn<SquadLaunchNowDeps['launch']>();

function build() {
  const store = createSquadProposalStore({ filePath: join(root, 'state', 'squad-proposals.json'), now: () => clock });
  const service = createSquadProposalService({
    store,
    enabled: () => enabledFlag,
    lookupProposer: (...a) => lookup(...a),
    projects: { get: (id) => ((id === 'p1' || id === 'p2') && projectOk ? { id, name: 'Proj', path: join(root, 'proj') } : undefined) },
    teams: { get: (id) => (id === teamRecord.id ? teamRecord : undefined) },
    personas: { get: (id) => personaMap[id] },
    teamHostProblem: () => hostProblem,
    expandTeamSlots: () => Array.from({ length: slotCount }),
    resolveSquadPlan: resolveSquadPlan as never,
    fs: {
      realpath: (p) => fsImpl.realpath(p),
      lstat: (p) => fsImpl.lstat(p),
      open: (p, f) => (readFails ? Promise.reject(new Error('EIO')) : fsImpl.open(p, f))
    },
    inbox: { appendOnce },
    actions: { bind, markUnavailable },
    issueSources,
    now: () => clock,
    newId: () => `prop-${++ids}`,
    sourceBases: () => ({ home: homeDir, cloneRoot: cloneDir }),
    logError,
    launchNow: {
      launchApproval: (...a) => launchApproval(...a),
      activeOwnedRuns: (...a) => activeOwnedRuns(...a),
      executionState: (...a) => executionState(...a),
      launch: (...a) => launchNow(...a)
    }
  });
  return { store, service, deps: undefined };
}

const route = { projectId: 'p1', sessionId: 's1' };
const input = { teamId: 'team1', goal: 'Build the thing\nwith details', planning: 'provided' as const, sources: ['plan.md'] };
let svc: ReturnType<typeof build>;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'squad-service-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'squad-outside-')));
  homeDir = realpathSync(mkdtempSync(join(tmpdir(), 'squad-home-')));
  cloneDir = realpathSync(mkdtempSync(join(tmpdir(), 'squad-clones-')));
  mkdirSync(join(root, 'proj', 'docs'), { recursive: true });
  writeFileSync(join(root, 'proj', 'plan.md'), '# plan');
  writeFileSync(join(outside, 'secret.md'), 'x');
  clock = 1000;
  ids = 0;
  enabledFlag = true;
  launchApproval.mockReset().mockResolvedValue('direct');
  activeOwnedRuns.mockReset().mockResolvedValue(0);
  let executions = 0;
  executionState.mockReset().mockResolvedValue('RUNNING');
  launchNow.mockReset().mockImplementation(async () => ({ ok: true, value: { executionId: `exec-${++executions}`, state: 'RUNNING' } }) as never);
  appendOnce.mockReset().mockImplementation(async (i) => ({ id: `entry-${i.dedupeKey}`, ...i }));
  bind.mockReset();
  markUnavailable.mockReset();
  issueSources.mockReset().mockResolvedValue([{ id: 'src1', name: 'plan.md', byteSize: 6, expiresAt: 9 }]);
  resolveSquadPlan.mockReset().mockReturnValue({
    workUnits: [{ id: 'u1', title: 'One', dependencies: [], files: ['a.ts'] }, { id: 'u2', title: 'Two', dependencies: ['u1'] }]
  });
  lookup = async () => ({ kind: 'pty', id: 's1', title: 'Design chat', squadMember: false, origin: { cwd: '/x' } });
  teamRecord = { id: 'team1', name: 'Crew', orchestratorPersonaId: 'orch', slots: [] } as unknown as Team;
  personaMap = { orch: writer, ro: reader };
  hostProblem = undefined;
  slotCount = 4;
  projectOk = true;
  readFails = false;
  fsImpl = realFs;
  logError.mockReset();
  svc = build();
});

const code = (r: { ok: boolean } & Record<string, unknown>) => (r.ok ? 'ok' : r.code);

describe('confineSource', () => {
  const fs = realFs;
  const proj = () => join(root, 'proj');
  let scope: SquadSourceScope;
  beforeEach(async () => { scope = (await sourceScope(fs, proj(), { home: homeDir, cloneRoot: cloneDir }))!; });

  it('accepts relative and absolute paths inside the project', async () => {
    const rel = await confineSource(fs, scope, 'plan.md');
    expect(rel).toMatchObject({ ok: true, source: { relPath: 'plan.md', bytes: 6, path: join(proj(), 'plan.md') } });
    expect(rel.ok && rel.source.outsideProject).toBeUndefined();
    expect(await confineSource(fs, scope, join(proj(), 'plan.md'))).toMatchObject({ ok: true });
  });
  it('accepts a HOME or clone-root file outside the project, marked with its display path', async () => {
    mkdirSync(join(homeDir, 'vault'));
    writeFileSync(join(homeDir, 'vault', 'design.md'), '# design');
    writeFileSync(join(cloneDir, 'plan.md'), '# plan');
    expect(await confineSource(fs, scope, join(homeDir, 'vault', 'design.md'))).toMatchObject({
      ok: true, source: { path: join(homeDir, 'vault', 'design.md'), relPath: join('~', 'vault', 'design.md'), outsideProject: true }
    });
    expect(await confineSource(fs, scope, join(cloneDir, 'plan.md'))).toMatchObject({ ok: true, source: { relPath: join(cloneDir, 'plan.md'), outsideProject: true } });
  });
  it('refuses credential stores and Zana\'s state, but reads Zana\'s library', async () => {
    mkdirSync(join(homeDir, '.ssh'));
    writeFileSync(join(homeDir, '.ssh', 'id_rsa'), 'PRIVATE');
    mkdirSync(join(homeDir, '.zcc', 'library'), { recursive: true });
    writeFileSync(join(homeDir, '.zcc', 'auth.json'), '{}');
    writeFileSync(join(homeDir, '.zcc', 'library', 'x.md'), '# x');
    const refused = await confineSource(fs, scope, join(homeDir, '.ssh', 'id_rsa'));
    expect(refused).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED', message: expect.stringContaining('protected location') });
    expect(await confineSource(fs, scope, join(homeDir, '.zcc', 'auth.json'))).toMatchObject({ code: 'SOURCE_NOT_ALLOWED' });
    expect(await confineSource(fs, scope, join(homeDir, '.zcc', 'library', 'x.md'))).toMatchObject({ ok: true, source: { outsideProject: true } });
    // A link inside the project can't reach a protected file.
    symlinkSync(join(homeDir, '.ssh', 'id_rsa'), join(proj(), 'key.md'));
    expect(await confineSource(fs, scope, 'key.md')).toMatchObject({ code: 'SOURCE_NOT_ALLOWED' });
  });
  it('rejects paths outside every base, links out of them, directories, the root itself and missing files', async () => {
    expect(await confineSource(fs, scope, relative(join(root, 'proj'), join(outside, 'secret.md')))).toMatchObject({
      code: 'SOURCE_NOT_ALLOWED', message: expect.stringContaining('outside this project, your home folder and the clone root')
    });
    expect(await confineSource(fs, scope, join(outside, 'secret.md'))).toMatchObject({ code: 'SOURCE_NOT_ALLOWED' });
    expect(await confineSource(fs, scope, '/etc/hosts')).toMatchObject({ code: 'SOURCE_NOT_ALLOWED' });
    symlinkSync(join(outside, 'secret.md'), join(proj(), 'link.md'));
    expect(await confineSource(fs, scope, 'link.md')).toMatchObject({ code: 'SOURCE_NOT_ALLOWED' });
    expect(await confineSource(fs, scope, 'docs')).toMatchObject({ code: 'SOURCE_NOT_FILE' });
    expect(await confineSource(fs, scope, '.')).toMatchObject({ code: 'SOURCE_NOT_ALLOWED' });
    expect(await confineSource(fs, scope, 'nope.md')).toMatchObject({ code: 'SOURCE_NOT_FILE' });
    expect(await sourceScope(fs, join(root, 'gone'), { home: homeDir })).toBeUndefined();
  });
  it('accepts a file whose name merely starts with two dots', async () => {
    writeFileSync(join(proj(), '..notes.md'), 'x');
    expect(await confineSource(fs, scope, '..notes.md')).toMatchObject({ ok: true, source: { relPath: '..notes.md' } });
  });
  it('refuses a hard-linked file, whose realpath looks harmless', async () => {
    mkdirSync(join(homeDir, '.ssh'), { recursive: true });
    writeFileSync(join(homeDir, '.ssh', 'id_rsa'), 'PRIVATE');
    linkSync(join(homeDir, '.ssh', 'id_rsa'), join(proj(), 'notes.md'));
    expect(await confineSource(fs, scope, 'notes.md')).toMatchObject({
      ok: false, code: 'SOURCE_NOT_ALLOWED', message: expect.stringContaining('hard-linked file')
    });
  });
  it('reports an lstat failure as not a file', async () => {
    const broken = { ...fs, lstat: async () => { throw new Error('x'); } };
    expect(await confineSource(broken, scope, 'plan.md')).toMatchObject({ code: 'SOURCE_NOT_FILE' });
  });
});

describe('reading confined sources', () => {
  const swapAtOpen = (swap: (path: string) => string | void): SquadProposalFs => ({
    ...realFs,
    open: async (path, flags) => fsp.open(swap(path) ?? path, flags)
  });

  it('refuses a source replaced by a symlink after it was checked', async () => {
    fsImpl = swapAtOpen((path) => { rmSync(path); symlinkSync(join(outside, 'secret.md'), path); });
    expect(await svc.service.propose(route, input)).toMatchObject({ ok: false, code: 'SOURCE_UNREADABLE' });
    expect(appendOnce).not.toHaveBeenCalled();
  });

  it('refuses a handle that is not the file the path resolves to (a swapped folder)', async () => {
    // The opened handle points outside while the path still resolves inside: device/inode differ.
    fsImpl = swapAtOpen(() => join(outside, 'secret.md'));
    expect(code(await svc.service.propose(route, input))).toBe('SOURCE_UNREADABLE');
    expect(await svc.service.checkPlan(route, { path: 'plan.md' })).toEqual({
      ok: false, code: 'SOURCE_UNREADABLE', message: 'plan.md could not be read, or it changed after it was checked.'
    });
  });

  it('refuses a file replaced after it was confined, even inside the project', async () => {
    // Keep the old file alive so the new one can't reuse its inode number (ext4 and tmpfs do).
    fsImpl = swapAtOpen((path) => { renameSync(path, `${path}.old`); writeFileSync(path, '# replaced'); });
    expect(code(await svc.service.checkPlan(route, { path: 'plan.md' }))).toBe('SOURCE_UNREADABLE');
    expect(resolveSquadPlan).not.toHaveBeenCalled();
  });

  it('refuses a source that grew while it was read', async () => {
    fsImpl = {
      ...realFs,
      open: async (path, flags) => {
        const handle = await fsp.open(path, flags);
        return { stat: async () => { const st = await handle.stat(); return Object.assign(st, { size: st.size - 1 }); }, read: handle.read.bind(handle), close: () => handle.close() } as never;
      }
    };
    expect(code(await svc.service.checkPlan(route, { path: 'plan.md' }))).toBe('SOURCE_UNREADABLE');
  });

  it('refuses a handle whose file gained a hard link after it was checked', async () => {
    fsImpl = {
      ...realFs,
      open: async (path, flags) => {
        const handle = await fsp.open(path, flags);
        return { stat: async () => Object.assign(await handle.stat(), { nlink: 2 }), read: handle.read.bind(handle), close: () => handle.close() } as never;
      }
    };
    expect(code(await svc.service.checkPlan(route, { path: 'plan.md' }))).toBe('SOURCE_UNREADABLE');
  });

  it('reads an unchanged source through the verified handle', async () => {
    expect(code(await svc.service.checkPlan(route, { path: 'plan.md' }))).toBe('ok');
    expect(resolveSquadPlan).toHaveBeenCalledWith('provided', ['# plan']);
  });
});

describe('propose', () => {
  it('checks in order', async () => {
    const run = (over: Record<string, unknown> = {}) => svc.service.propose(route, { ...input, ...over } as never);

    const disabled = createSquadProposalService({ ...({} as SquadProposalServiceDeps), enabled: () => false });
    expect(code(await disabled.propose(route, input))).toBe('DISABLED');

    lookup = async () => null;
    expect(code(await run())).toBe('NOT_LIVE');
    lookup = async () => ({ kind: 'pty', id: 's1', squadMember: true });
    expect(code(await run())).toBe('PROPOSER_IN_SQUAD');
    lookup = async () => ({ kind: 'pty', id: 's1', squadMember: false });

    for (const bad of [{ teamId: '' }, { goal: ' ' }, { goal: 'x'.repeat(2049) }, { planning: 'wat' }, { title: 'x'.repeat(257) },
       { summary: 'x'.repeat(2049) }, { completionInboxNotice: 'yes' }, { sources: 'plan.md' }, { sources: [''] }]) {
      expect(code(await run(bad))).toBe('INVALID');
    }
    expect(code(await svc.service.propose(route, null as never))).toBe('INVALID');
    expect(await run({ goal: 'x'.repeat(2049) })).toEqual({ ok: false, code: 'INVALID', message: squadGoalTooLongMessage(2049) });
    expect(await run({ summary: 'x'.repeat(2049) })).toEqual({ ok: false, code: 'INVALID', message: squadSummaryTooLongMessage(2049) });

    expect(await run({ summary: 5 as never })).toEqual({ ok: false, code: 'INVALID', message: 'summary must be text.' });

    projectOk = false;
    expect(code(await run())).toBe('NOT_FOUND');
    projectOk = true;
    hostProblem = 'remote host';
    expect(await run()).toMatchObject({ code: 'HOST_UNSUPPORTED', message: 'remote host' });
    hostProblem = undefined;
    expect(code(await run({ teamId: 'zzz' }))).toBe('TEAM_NOT_FOUND');
    teamRecord.orchestratorPersonaId = 'missing';
    expect(code(await run())).toBe('NO_ORCHESTRATOR');
    teamRecord.orchestratorPersonaId = 'orch';
    slotCount = 0;
    expect(code(await run())).toBe('INVALID');
    slotCount = 33;
    expect(code(await run())).toBe('INVALID');
    slotCount = 4;
    expect(code(await run({ sources: Array.from({ length: 17 }, (_, i) => `f${i}`) }))).toBe('TOO_MANY_SOURCES');
    expect(code(await run({ sources: [relative(join(root, 'proj'), join(outside, 'secret.md'))] }))).toBe('SOURCE_NOT_ALLOWED');
    expect(code(await run({ sources: ['docs'] }))).toBe('SOURCE_NOT_FILE');
    expect(appendOnce).not.toHaveBeenCalled();
  });

  it('enforces size caps with real files', async () => {
    const big = join(root, 'proj', 'big.md');
    writeFileSync(big, '');
    truncateSync(big, 4 * 1024 * 1024 + 1);
    expect(code(await svc.service.propose(route, { ...input, sources: ['big.md'] }))).toBe('SOURCE_TOO_LARGE');
    // Four 4 MiB files fit exactly; a fifth distinct one breaks the 16 MiB total.
    const names: string[] = [];
    for (let i = 0; i < 5; i++) { const n = `m${i}.md`; writeFileSync(join(root, 'proj', n), ''); truncateSync(join(root, 'proj', n), 4 * 1024 * 1024); names.push(n); }
    const r = await svc.service.propose(route, { ...input, planning: 'infer', sources: names });
    expect(code(r)).toBe('SOURCE_TOO_LARGE');
  });

  it('de-duplicates sources by realpath', async () => {
    symlinkSync(join(root, 'proj', 'plan.md'), join(root, 'proj', 'alias.md'));
    const r = await svc.service.propose(route, { ...input, sources: ['plan.md', 'alias.md', './plan.md'] });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(r.value.sources).toEqual([{ path: 'plan.md', bytes: 6 }]);
  });

  it('resolves planning: input, then team default, then persona capability', async () => {
    const plan = async (over: Record<string, unknown>) => {
      const r = await svc.service.propose(route, { teamId: 'team1', goal: 'g', ...over } as never);
      return r.ok ? r.value.planning : code(r);
    };
    expect(await plan({ planning: 'infer' })).toBe('infer');
    expect(await plan({})).toBe('infer'); // writer persona
    teamRecord.defaultPlanning = 'provided';
    expect(await plan({})).toBe('provided');
    expect(await plan({ planning: 'infer' })).toBe('infer');
    teamRecord.defaultPlanning = undefined;
    teamRecord.orchestratorPersonaId = 'ro';
    expect(await plan({})).toBe('provided');
  });

  it('refuses infer for an orchestrator that cannot write, with the exact message', async () => {
    teamRecord.orchestratorPersonaId = 'ro';
    const r = await svc.service.propose(route, { ...input, planning: 'infer' });
    expect(r).toEqual({
      ok: false, code: 'ORCHESTRATOR_CANNOT_PLAN',
      message: "Planner can't write files, so Infer plan from goal can't finish. Write a portable plan, check it with squad_plan_check, and propose with planning 'provided'."
    });
  });

  it('judges infer on the team transport: Modern needs register, not file write', async () => {
    teamRecord.orchestratorPersonaId = 'ro';
    teamRecord.transport = 'MODERN';
    const r = await svc.service.propose(route, { teamId: 'team1', goal: 'g' } as never);
    expect(r.ok && r.value.planning).toBe('infer');
    personaMap.nr = { id: 'nr', name: 'NoReg', deniedTools: ['mcp__zcc-inbox__execution.plan.register'] } as Persona;
    teamRecord.orchestratorPersonaId = 'nr';
    expect(await svc.service.propose(route, { ...input, planning: 'infer' })).toEqual({
      ok: false, code: 'ORCHESTRATOR_CANNOT_PLAN',
      message: "NoReg can't call execution.plan.register, so Infer plan from goal can't finish. Write a portable plan, check it with squad_plan_check, and propose with planning 'provided'."
    });
  });

  it('passes plan errors through and requires plan steps', async () => {
    resolveSquadPlan.mockReturnValue({ planError: 'unit u2 depends on missing u9' });
    expect(await svc.service.propose(route, input)).toEqual({ ok: false, code: 'INVALID_PLAN', message: 'unit u2 depends on missing u9' });
    resolveSquadPlan.mockReturnValue({ workUnits: [] });
    expect(code(await svc.service.propose(route, input))).toBe('INVALID_PLAN');
    resolveSquadPlan.mockReturnValue({ workUnits: [{ id: 'u1', title: 'One', dependencies: [] }] });
    const unreadable = createSquadProposalService({ ...({} as SquadProposalServiceDeps), enabled: () => true });
    expect(code(await unreadable.propose(route, input))).toBe('INVALID'); // dependency failure never throws
  });

  it('reports unreadable sources', async () => {
    readFails = true;
    expect(code(await svc.service.propose(route, input))).toBe('SOURCE_UNREADABLE');
  });

  it('holds the pending cap when proposals arrive concurrently', async () => {
    const results = await Promise.all(Array.from({ length: 25 }, (_, i) => svc.service.propose(route, { teamId: 'team1', goal: `c${i}`, planning: 'infer' })));
    expect(results.filter((r) => r.ok)).toHaveLength(20);
    expect(results.filter((r) => !r.ok && r.code === 'TOO_MANY_PROPOSALS')).toHaveLength(5);
    expect(await svc.store.listPending('p1')).toHaveLength(20);
  });

  it('limits pending proposals per project (21st fails) before reading any source', async () => {
    for (let i = 0; i < 20; i++) expect(code(await svc.service.propose(route, { teamId: 'team1', goal: `g${i}`, planning: 'infer' }))).toBe('ok');
    resolveSquadPlan.mockClear();
    expect(code(await svc.service.propose(route, input))).toBe('TOO_MANY_PROPOSALS');
    expect(resolveSquadPlan).not.toHaveBeenCalled();
  });

  it('refuses a goal that names a file outside the project (D3)', async () => {
    const r = await svc.service.propose(route, { ...input, goal: `Read ${join(outside, 'secret.md')} and build it` });
    expect(r).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED', message: expect.stringContaining('secret.md') });
    expect(appendOnce).not.toHaveBeenCalled();
    const quoted = await svc.service.propose(route, { ...input, goal: `Use "${join(outside, 'secret.md')}".` });
    expect(code(quoted)).toBe('SOURCE_NOT_ALLOWED');
  });

  it('accepts goal paths inside the project and ignores paths that do not exist', async () => {
    expect(code(await svc.service.propose(route, { ...input, goal: `Follow ${join(root, 'proj', 'plan.md')}.` }))).toBe('ok');
    expect(code(await svc.service.propose(route, { ...input, goal: 'See /no/such/file.md and (/also/missing)' }))).toBe('ok');
  });

  it('fails cleanly when the Inbox card action cannot be bound', async () => {
    bind.mockReturnValue(false);
    const r = await svc.service.propose(route, input);
    expect(r).toEqual({ ok: false, code: 'INVALID', message: 'Could not create the Inbox card for this Squad launch. Try again.' });
    expect(logError).toHaveBeenCalledWith('squad proposal prop-1 card', expect.objectContaining({ message: 'the Inbox card action could not be registered' }));
    expect(await svc.store.listPending('p1')).toHaveLength(0);
  });

  it('still reports a live, bound card when recording its entry id fails', async () => {
    const update = svc.store.update.bind(svc.store);
    vi.spyOn(svc.store, 'update').mockImplementation(async (id, mutate) => {
      const probe = { inboxEntryId: undefined } as { inboxEntryId?: string };
      mutate(probe as never);
      if (probe.inboxEntryId) throw new Error('disk full at /Users/me/.zcc');
      return update(id, mutate);
    });
    const r = await svc.service.propose(route, input);
    expect(r).toMatchObject({ ok: true, value: { proposalId: 'prop-1', inboxEntryId: 'entry-squad-proposal:prop-1' } });
    expect(logError).toHaveBeenCalledWith('squad proposal prop-1 inbox entry id', expect.any(Error));
    expect(await svc.store.get('prop-1')).toMatchObject({ state: 'pending' });
  });

  it('logs an unexpected failure and returns a message without its internals', async () => {
    lookup = async () => { throw new Error('SQLITE_BUSY: /Users/me/.zcc/zcc.db'); };
    const r = await svc.service.propose(route, input);
    expect(r).toEqual({ ok: false, code: 'INVALID', message: 'The Squad launch proposal failed unexpectedly. Try again.' });
    expect(logError).toHaveBeenCalledWith('squad proposal propose', expect.objectContaining({ message: expect.stringContaining('SQLITE_BUSY') }));
  });

  it('creates the record and the Inbox card', async () => {
    const r = await svc.service.propose(route, input);
    expect(r).toMatchObject({ ok: true, value: {
      proposalId: 'prop-1', inboxEntryId: 'entry-squad-proposal:prop-1', planning: 'provided',
      team: { id: 'team1', name: 'Crew', workers: 3, orchestrator: 'Lead' },
      plan: { steps: [{ id: 'u1', title: 'One' }, { id: 'u2', title: 'Two' }] },
      sources: [{ path: 'plan.md', bytes: 6 }], expiresAt: 1000 + 7 * 24 * 60 * 60 * 1000
    } });
    const card = appendOnce.mock.calls[0]![0];
    expect(card).toMatchObject({
      projectId: 'p1', subject: 'Squad launch ready: Build the thing', intent: 'Prepared in "Design chat"',
      docs: [{ path: 'plan.md' }], hostActionRequired: true, squadProposal: { proposalId: 'prop-1' },
      questions: [{ prompt: 'Squad launch', options: [{ id: 'dismiss', label: 'Dismiss' }] }],
      dedupeKey: 'squad-proposal:prop-1', sessionId: 's1', origin: { cwd: '/x' }
    });
    expect(card.comments).toBe([
      '- Squad: Crew (Lead + 3 workers)',
      '- Planning: Plan provided in goal — plan checked: 2 steps',
      '- Files: plan.md',
      '- Nothing starts until you press Launch.'
    ].join('\n'));
    expect(bind).toHaveBeenCalledWith(expect.objectContaining({ id: 'entry-squad-proposal:prop-1' }), { kind: SQUAD_LAUNCH_PROPOSAL_ACTION, ref: 'prop-1' });
    expect((await svc.store.get('prop-1'))).toMatchObject({ inboxEntryId: 'entry-squad-proposal:prop-1', title: 'Build the thing', state: 'pending' });
  });

  it('attaches a design outside the project by its exact path, and shows where it is', async () => {
    mkdirSync(join(homeDir, 'vault'));
    const design = join(homeDir, 'vault', 'design.md');
    writeFileSync(design, '# design');
    const r = await svc.service.propose(route, { ...input, sources: ['plan.md', design] });
    expect(r).toMatchObject({ ok: true, value: { sources: [{ path: 'plan.md', bytes: 6 }, { path: join('~', 'vault', 'design.md'), bytes: 8, outsideProject: true }] } });
    const card = appendOnce.mock.calls[0]![0];
    expect(card.comments).toContain(`- Files: plan.md, ${join('~', 'vault', 'design.md')} (outside the Project)`);
    // Inbox documents open inside the project only; the outside file is named in the comments.
    expect(card.docs).toEqual([{ path: 'plan.md' }]);
    expect((await svc.store.get('prop-1'))?.sources[1]).toEqual({ path: design, relPath: join('~', 'vault', 'design.md'), bytes: 8, outsideProject: true });
  });

  it('refuses a goal path outside the Project that the policy allows, and says to pass it in sources', async () => {
    mkdirSync(join(homeDir, 'vault'));
    const design = join(homeDir, 'vault', 'design.md');
    writeFileSync(design, '# design');
    const r = await svc.service.propose(route, { ...input, goal: `Summarise ${design}` });
    expect(r).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED', message: expect.stringContaining('Pass it in sources') });
    expect(appendOnce).not.toHaveBeenCalled();
    // Named in sources, it shows on the card instead.
    expect(code(await svc.service.propose(route, { ...input, goal: 'Summarise the design', sources: [design] }))).toBe('ok');
  });

  it('ignores a folder named in a goal (Launch only attaches regular files)', async () => {
    mkdirSync(join(root, 'proj', 'folder'));
    mkdirSync(join(homeDir, 'vault'));
    expect(code(await svc.service.propose(route, { ...input, goal: `Read everything under ${join(root, 'proj', 'folder')} and ${join(homeDir, 'vault')}` }))).toBe('ok');
  });

  it('refuses a goal naming a hard-linked file, as Launch could not attach it', async () => {
    writeFileSync(join(root, 'proj', 'twin.md'), 'x');
    linkSync(join(root, 'proj', 'twin.md'), join(root, 'proj', 'twin2.md'));
    const r = await svc.service.propose(route, { ...input, goal: `Read ${join(root, 'proj', 'twin2.md')}` });
    expect(r).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED', message: expect.stringContaining('hard-linked') });
  });

  it('refuses a goal naming a protected file, with the policy in the message', async () => {
    mkdirSync(join(homeDir, '.aws'));
    writeFileSync(join(homeDir, '.aws', 'credentials'), 'KEY');
    const r = await svc.service.propose(route, { ...input, goal: `Use ${join(homeDir, '.aws', 'credentials')} to deploy` });
    expect(r).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED', message: expect.stringContaining('~/.aws') });
  });

  it('uses the given title, a thread origin and the conversation fallback', async () => {
    lookup = async () => ({ kind: 'thread', id: 'th1', squadMember: false });
    await svc.service.propose(route, { teamId: 'team1', goal: 'g', planning: 'infer', title: 'Mine', summary: 'S' });
    const card = appendOnce.mock.calls[0]![0];
    expect(card).toMatchObject({ subject: 'Squad launch ready: Mine', intent: 'Prepared in "a conversation"', origin: { threadId: 'th1' }, sessionId: 'th1' });
    expect(card.comments).toContain('Planning: Infer plan from goal');
    expect(card.comments).not.toContain('Files:');
    expect(await svc.store.get('prop-1')).toMatchObject({ summary: 'S' });
  });

  it('dismisses the record when the card cannot be created', async () => {
    appendOnce.mockRejectedValue(new Error('inbox down'));
    const r = await svc.service.propose(route, input);
    expect(r).toMatchObject({ ok: false, code: 'INVALID' });
    expect(!r.ok && r.message).not.toContain('inbox down');
    expect((await svc.store.get('prop-1'))?.state).toBe('dismissed');
  });

  it('truncates a long first line to 80 chars', async () => {
    await svc.service.propose(route, { teamId: 'team1', goal: 'y'.repeat(200), planning: 'infer' });
    expect((await svc.store.get('prop-1'))?.title).toHaveLength(80);
  });
});

describe('launchSquadNow', () => {
  const now = (over: Record<string, unknown> = {}, at = route) => svc.service.launchSquadNow(at, { ...input, ...over } as never);
  const nothingStarted = () => {
    expect(launchNow).not.toHaveBeenCalled();
    expect(issueSources).not.toHaveBeenCalled();
    expect(appendOnce).not.toHaveBeenCalled();
  };

  it('fails closed when starting immediately is not wired, before any other check', async () => {
    const lookupSpy = vi.fn();
    const unwired = createSquadProposalService({ ...({} as SquadProposalServiceDeps), enabled: () => true, lookupProposer: lookupSpy });
    expect(await unwired.launchSquadNow(route, input)).toEqual({
      ok: false, code: 'LAUNCH_APPROVAL_UNAVAILABLE',
      message: 'Starting a Squad immediately is not available here, so the run was not started.'
    });
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it('refuses when Team jobs are off, before anything else', async () => {
    enabledFlag = false;
    expect(code(await now())).toBe('DISABLED');
    nothingStarted();
  });

  it('starts the Squad owned by the calling conversation, with its sources issued to that session', async () => {
    const r = await now({ title: '  Mine ', summary: ' S ' });
    expect(r).toEqual({ ok: true, value: {
      executionId: 'exec-1', state: 'RUNNING', planning: 'provided',
      team: { id: 'team1', name: 'Crew', workers: 3, orchestrator: 'Lead' },
      plan: { steps: [{ id: 'u1', title: 'One' }, { id: 'u2', title: 'Two' }] },
      sources: [{ path: 'plan.md', bytes: 6 }]
    } });
    expect(launchNow).toHaveBeenCalledTimes(1);
    const [request, ctx] = launchNow.mock.calls[0]!;
    expect(request).toEqual({
       team: teamRecord, project: { id: 'p1', name: 'Proj', path: join(root, 'proj') }, goal: 'Build the thing\nwith details',
       coordinationMode: 'structured', title: 'Mine', summary: 'S', completionInboxNotice: false,
       sourcePaths: [join(root, 'proj', 'plan.md')]
    });
    expect(ctx).toEqual({
      sources: { kind: 'session', sessionId: 's1' },
      owner: { principalId: 's1', reportTo: { kind: 'pty', id: 's1', role: 'owner' } }
    });
    expect(activeOwnedRuns).toHaveBeenCalledWith('s1', 'p1');
    // No proposal record, no Inbox card, no window capability.
    expect(await svc.store.listPending('p1')).toHaveLength(0);
    expect(appendOnce).not.toHaveBeenCalled();
    expect(issueSources).not.toHaveBeenCalled();
  });

  it('defaults completion inbox notices off and forwards an explicit opt-in', async () => {
    await now();
    expect(launchNow.mock.calls[0]![0]).toMatchObject({ completionInboxNotice: false });

    await now({ goal: 'Notify me', completionInboxNotice: true });
    expect(launchNow.mock.calls[1]![0]).toMatchObject({ completionInboxNotice: true });
  });

  it('reports to a Modern thread as a thread, and leaves out an empty title and summary', async () => {
    lookup = async () => ({ kind: 'thread', id: 'th1', squadMember: false });
    await now({ planning: 'infer', sources: [], title: ' ', summary: '' }, { projectId: 'p1', sessionId: 'th1' });
    const [request, ctx] = launchNow.mock.calls[0]!;
    expect(request).toEqual(expect.not.objectContaining({ title: expect.anything() }));
    expect(request).not.toHaveProperty('summary');
    expect(request).toMatchObject({ coordinationMode: 'freeform', sourcePaths: [] });
    expect(ctx.owner).toEqual({ principalId: 'th1', reportTo: { kind: 'thread', id: 'th1', role: 'owner' } });
  });

  it('refuses a conversation that is not live or is a Squad member', async () => {
    lookup = async () => null;
    expect(code(await now())).toBe('NOT_LIVE');
    lookup = async () => ({ kind: 'pty', id: 's1', squadMember: true });
    expect(await now()).toEqual({ ok: false, code: 'PROPOSER_IN_SQUAD', message: 'Members of a running Squad cannot launch a Squad.' });
    nothingStarted();
  });

  it('refuses exactly what propose refuses, for the same input', async () => {
    writeFileSync(join(root, 'proj', 'twin.md'), 'x');
    linkSync(join(root, 'proj', 'twin.md'), join(root, 'proj', 'twin2.md'));
    const cases: Array<Record<string, unknown>> = [
      { teamId: '' }, { goal: ' ' }, { planning: 'wat' }, { sources: 'plan.md' }, { teamId: 'zzz' },
      { sources: Array.from({ length: 17 }, (_, i) => `f${i}`) },
      { sources: [relative(join(root, 'proj'), join(outside, 'secret.md'))] },
      { sources: ['docs'] },
      { goal: `Read ${join(outside, 'secret.md')} and build it` },
      { goal: `Read ${join(root, 'proj', 'twin2.md')}` }
    ];
    for (const over of cases) {
      const viaPropose = await svc.service.propose(route, { ...input, ...over } as never);
      expect(viaPropose.ok, JSON.stringify(over)).toBe(false);
      expect(await now(over)).toEqual(viaPropose);
    }
    teamRecord.orchestratorPersonaId = 'ro';
    expect(await now({ planning: 'infer' })).toEqual(await svc.service.propose(route, { ...input, planning: 'infer' }));
    expect(code(await now({ planning: 'infer' }))).toBe('ORCHESTRATOR_CANNOT_PLAN');
    teamRecord.orchestratorPersonaId = 'orch';
    resolveSquadPlan.mockReturnValue({ planError: 'unit u2 depends on missing u9' });
    expect(await now()).toEqual({ ok: false, code: 'INVALID_PLAN', message: 'unit u2 depends on missing u9' });
    expect(await svc.service.propose(route, input)).toEqual(await now());
    expect(launchNow).not.toHaveBeenCalled();
    expect(issueSources).not.toHaveBeenCalled();
  });

  it('refuses when the effective approval is review, before any launch', async () => {
    launchApproval.mockResolvedValue('review');
    expect(await now()).toEqual({
      ok: false, code: 'LAUNCH_REVIEW_REQUIRED',
      message: "This Squad requires review before launch. Use squad_launch with mode 'review' so the user can Launch it from the Inbox."
    });
    expect(launchApproval).toHaveBeenCalledWith('team1', 'p1');
    expect(activeOwnedRuns).not.toHaveBeenCalled();
    nothingStarted();
  });

  it('launches when the effective approval is direct', async () => {
    expect(code(await now())).toBe('ok');
    expect(code(await now({ goal: 'other' }))).toBe('ok');
    expect(launchNow).toHaveBeenCalledTimes(2);
  });

  it('refuses when the approval setting cannot be read, and logs why', async () => {
    launchApproval.mockRejectedValue(new Error('runtime down'));
    expect(await now()).toEqual({
      ok: false, code: 'LAUNCH_APPROVAL_UNAVAILABLE', message: 'The Squad launch approval setting could not be read, so the run was not started.'
    });
    expect(logError).toHaveBeenCalledWith('squad proposal launch now approval', expect.any(Error));
    nothingStarted();
  });

  it('returns the run it already started for an identical repeat, and starts one for a different call', async () => {
    const first = await now();
    const again = await now({ title: 'retitled', sources: ['./plan.md'] });
    expect(again).toEqual({ ok: true, value: { ...(first.ok ? first.value : {}), deduped: true } });
    expect(launchNow).toHaveBeenCalledTimes(1);
    expect(activeOwnedRuns).toHaveBeenCalledTimes(1);
    // Another conversation, goal, Squad or planning is a new launch.
    lookup = async () => ({ kind: 'pty', id: 's2', squadMember: false });
    expect(await now({}, { projectId: 'p1', sessionId: 's2' })).toMatchObject({ ok: true, value: { executionId: 'exec-2' } });
    expect(await now({ goal: 'Build the other thing' }, { projectId: 'p1', sessionId: 's2' })).toMatchObject({ value: { executionId: 'exec-3' } });
    expect(await now({ planning: 'infer', goal: 'Build the other thing' }, { projectId: 'p1', sessionId: 's2' })).toMatchObject({ value: { executionId: 'exec-4' } });
  });

  it('does not dedupe the same launch across projects', async () => {
    await now();
    const other = await now({}, { projectId: 'p2', sessionId: 's1' });
    expect(other).toMatchObject({ ok: true, value: { executionId: 'exec-2' } });
    expect((other as { value: { deduped?: true } }).value.deduped).toBeUndefined();
    expect(launchNow).toHaveBeenCalledTimes(2);
  });

  it('reports the current state of the run a repeat is deduped against', async () => {
    await now();
    executionState.mockResolvedValue('BLOCKED');
    expect(await now()).toMatchObject({ ok: true, value: { executionId: 'exec-1', state: 'BLOCKED', deduped: true } });
    expect(executionState).toHaveBeenCalledWith('exec-1');
    expect(launchNow).toHaveBeenCalledTimes(1);
  });

  it.each(['COMPLETED', 'FAILED', 'STOPPED'] as const)('starts a new run when the repeated run is %s', async (state) => {
    await now();
    executionState.mockResolvedValue(state);
    const again = await now();
    expect(again).toMatchObject({ ok: true, value: { executionId: 'exec-2', state: 'RUNNING' } });
    expect((again as { value: { deduped?: true } }).value.deduped).toBeUndefined();
    expect(launchNow).toHaveBeenCalledTimes(2);
  });

  it('starts a new run when the repeated run cannot be found', async () => {
    await now();
    executionState.mockResolvedValue(undefined);
    expect(await now()).toMatchObject({ ok: true, value: { executionId: 'exec-2' } });
    expect(launchNow).toHaveBeenCalledTimes(2);
  });

  it('keeps deduping, and logs, when the repeated run lookup throws', async () => {
    await now();
    executionState.mockRejectedValue(new Error('db locked'));
    expect(await now()).toMatchObject({ ok: true, value: { executionId: 'exec-1', deduped: true } });
    expect(logError).toHaveBeenCalledWith('squad proposal launch now state', expect.any(Error));
    expect(launchNow).toHaveBeenCalledTimes(1);
  });

  it('treats a goal differing only in surrounding whitespace as identical', async () => {
    const first = await now();
    expect(await now({ goal: `  ${input.goal}\n` })).toEqual({ ok: true, value: { ...(first.ok ? first.value : {}), deduped: true } });
    expect(launchNow).toHaveBeenCalledTimes(1);
  });

  it('treats the same sources in another order as identical', async () => {
    writeFileSync(join(root, 'proj', 'more.md'), '# more');
    await now({ sources: ['plan.md', 'more.md'] });
    expect(await now({ sources: ['more.md', 'plan.md'] })).toMatchObject({ ok: true, value: { executionId: 'exec-1', deduped: true } });
  });

  it('forgets a launch after the dedupe window', async () => {
    await now();
    clock += 10 * 60_000 - 1;
    expect(await now()).toMatchObject({ value: { deduped: true } });
    clock += 1;
    expect(await now()).toMatchObject({ ok: true, value: { executionId: 'exec-2' } });
    expect((await now()) as { value: { deduped?: true } }).toMatchObject({ value: { executionId: 'exec-2', deduped: true } });
  });

  it('keeps only a bounded number of recent launches', async () => {
    for (let i = 0; i < 257; i++) expect(code(await now({ goal: `g${i}`, planning: 'infer', sources: [] }))).toBe('ok');
    // The oldest was dropped; the newest is still recognised.
    expect(await now({ goal: 'g256', planning: 'infer', sources: [] })).toMatchObject({ value: { deduped: true } });
    expect(await now({ goal: 'g0', planning: 'infer', sources: [] })).toMatchObject({ value: { executionId: 'exec-258' } });
  });

  it('records nothing for a failed start, so a retry launches', async () => {
    launchNow.mockResolvedValueOnce({ ok: false, code: 'SOURCE_CHANGED', message: 'plan.md changed' });
    expect(await now()).toEqual({ ok: false, code: 'SOURCE_CHANGED', message: 'plan.md changed' });
    expect(await now()).toMatchObject({ ok: true, value: { executionId: 'exec-1' } });
    expect(await now()).toMatchObject({ value: { deduped: true } });
  });

  it('lets one launch per conversation run at a time, and releases it after success', async () => {
    let finish!: () => void;
    launchNow.mockImplementationOnce(() => new Promise((done) => { finish = () => done({ ok: true, value: { executionId: 'slow', state: 'RUNNING' } } as never); }));
    const slow = now();
    await vi.waitFor(() => expect(launchNow).toHaveBeenCalledTimes(1));
    expect(await now({ goal: 'second' })).toEqual({
      ok: false, code: 'LAUNCH_IN_PROGRESS', message: 'A Squad launch from this conversation is already starting. Wait for it to finish.'
    });
    // Another conversation is not held up.
    lookup = async () => ({ kind: 'pty', id: 's2', squadMember: false });
    expect(code(await now({ goal: 'second' }, { projectId: 'p1', sessionId: 's2' }))).toBe('ok');
    lookup = async () => ({ kind: 'pty', id: 's1', squadMember: false });
    finish();
    expect(await slow).toMatchObject({ ok: true, value: { executionId: 'slow' } });
    expect(code(await now({ goal: 'third' }))).toBe('ok');
  });

  it('returns the finished launch to an identical call that was preparing meanwhile', async () => {
    let finish!: () => void;
    launchNow.mockImplementationOnce(() => new Promise((done) => { finish = () => done({ ok: true, value: { executionId: 'slow', state: 'RUNNING' } } as never); }));
    let releasePrepare!: () => void;
    const slow = now();
    await vi.waitFor(() => expect(launchNow).toHaveBeenCalledTimes(1));
    const gate = new Promise<void>((done) => { releasePrepare = done; });
    const realLookup = lookup;
    lookup = async (...a) => { await gate; return realLookup(...a); };
    const repeat = now();
    finish();
    await slow;
    releasePrepare();
    expect(await repeat).toMatchObject({ ok: true, value: { executionId: 'slow', deduped: true } });
    expect(launchNow).toHaveBeenCalledTimes(1);
  });

  it('releases the in-flight hold after a refusal or a throw', async () => {
    activeOwnedRuns.mockResolvedValueOnce(MAX_ACTIVE_NOW_RUNS_PER_SESSION);
    expect(await now()).toEqual({
      ok: false, code: 'TOO_MANY_LAUNCHES',
      message: 'This conversation already owns 3 running Squads. Wait for one to finish, or stop one, before starting another.'
    });
    expect(launchNow).not.toHaveBeenCalled();
    launchNow.mockRejectedValueOnce(new Error('spawn failed at /Users/me/.zcc'));
    expect(await now()).toEqual({ ok: false, code: 'INVALID', message: 'Starting the Squad failed unexpectedly. Try again.' });
    expect(logError).toHaveBeenCalledWith('squad proposal launch now', expect.any(Error));
    activeOwnedRuns.mockRejectedValueOnce(new Error('store locked'));
    expect(code(await now())).toBe('INVALID');
    expect(code(await now())).toBe('ok');
  });

  it('allows starts while the conversation owns fewer than the cap', async () => {
    activeOwnedRuns.mockResolvedValue(MAX_ACTIVE_NOW_RUNS_PER_SESSION - 1);
    expect(code(await now())).toBe('ok');
    activeOwnedRuns.mockResolvedValue(MAX_ACTIVE_NOW_RUNS_PER_SESSION + 1);
    expect(code(await now({ goal: 'more' }))).toBe('TOO_MANY_LAUNCHES');
  });

  it('frees a hung launch only after the lease timeout', async () => {
    launchNow.mockImplementationOnce(() => new Promise(() => undefined));
    void now();
    await vi.waitFor(() => expect(launchNow).toHaveBeenCalledTimes(1));
    expect(code(await now({ goal: 'next' }))).toBe('LAUNCH_IN_PROGRESS');
    clock += 10 * 60_000;
    expect(code(await now({ goal: 'next' }))).toBe('ok');
  });
});

describe('checkPlan', () => {
  it('validates input and reports plans', async () => {
    const s = svc.service;
    expect(code(await s.checkPlan(route, {}))).toBe('INVALID');
    expect(code(await s.checkPlan(route, { path: 'plan.md', text: 'x' }))).toBe('INVALID');
    expect(await s.checkPlan(route, { path: 'plan.md' })).toMatchObject({ ok: true, value: { ok: true, steps: [
      { id: 'u1', writeScope: ['a.ts'] }, { id: 'u2', dependencies: ['u1'], writeScope: [] }] } });
    expect(resolveSquadPlan).toHaveBeenCalledWith('provided', ['# plan']);
    expect(await s.checkPlan(route, { text: 'inline' })).toMatchObject({ ok: true, value: { ok: true } });
    resolveSquadPlan.mockReturnValue({ planError: 'bad' });
    expect(await s.checkPlan(route, { text: 'inline' })).toEqual({ ok: true, value: { ok: false, reason: 'bad' } });
    resolveSquadPlan.mockReturnValue({});
    expect(await s.checkPlan(route, { text: 'inline' })).toMatchObject({ ok: true, value: { ok: false } });
  });
  it('rejects path problems and oversize text', async () => {
    const s = svc.service;
    expect(code(await s.checkPlan(route, { path: join(outside, 'secret.md') }))).toBe('SOURCE_NOT_ALLOWED');
    expect(code(await s.checkPlan(route, { text: 'x'.repeat(1_048_577) }))).toBe('INVALID');
    const big = join(root, 'proj', 'bigplan.md');
    writeFileSync(big, '');
    truncateSync(big, 1_048_577);
    // A path is confined like a source (4 MiB), so a 1-4 MiB plan that proposes fine also checks.
    expect(code(await s.checkPlan(route, { path: 'bigplan.md' }))).toBe('ok');
    truncateSync(big, 4 * 1024 * 1024 + 1);
    expect(code(await s.checkPlan(route, { path: 'bigplan.md' }))).toBe('SOURCE_TOO_LARGE');
    lookup = async () => null;
    expect(code(await s.checkPlan(route, { text: 'x' }))).toBe('NOT_LIVE');
    lookup = async () => ({ kind: 'pty', id: 's1', squadMember: false });
    projectOk = false;
    expect(code(await s.checkPlan(route, { path: 'plan.md' }))).toBe('NOT_FOUND');
    const off = createSquadProposalService({ ...({} as SquadProposalServiceDeps), enabled: () => false });
    expect(code(await off.checkPlan(route, { text: 'x' }))).toBe('DISABLED');
    const broken = createSquadProposalService({ ...({} as SquadProposalServiceDeps), enabled: () => true });
    expect(code(await broken.checkPlan(route, { text: 'x' }))).toBe('INVALID');
  });
});

describe('handleAction', () => {
  it('dismisses a pending record and refuses everything else', async () => {
    await svc.service.propose(route, { teamId: 'team1', goal: 'g', planning: 'infer' });
    await expect(svc.service.handleAction({ ref: 'prop-1', input: { optionId: 'nope' } })).rejects.toBeInstanceOf(InboxActionOperatorError);
    await svc.service.handleAction({ ref: 'prop-1', input: { optionId: 'dismiss' } });
    expect((await svc.store.get('prop-1'))?.state).toBe('dismissed');
    await expect(svc.service.handleAction({ ref: 'prop-1', input: { optionId: 'dismiss' } })).rejects.toBeInstanceOf(InboxActionOperatorError);
    await expect(svc.service.handleAction({ ref: 'ghost', input: { optionId: 'dismiss' } })).rejects.toBeInstanceOf(InboxActionOperatorError);
  });
});

describe('review', () => {
  const allow = () => true;
  beforeEach(async () => { await svc.service.propose(route, input); });

  it('refuses while Squad launches are turned off', async () => {
    enabledFlag = false;
    expect(code(await svc.service.review(1, 'prop-1', allow))).toBe('DISABLED');
    expect(issueSources).not.toHaveBeenCalled();
  });

  it('returns a prefill with realpaths issued to the window', async () => {
    const r = await svc.service.review(7, 'prop-1', allow);
    expect(r).toEqual({ ok: true, value: {
      proposalId: 'prop-1', projectId: 'p1', teamId: 'team1', coordinationMode: 'structured', goal: input.goal,
      title: 'Build the thing', sources: [{ id: 'src1', name: 'plan.md', byteSize: 6, expiresAt: 9 }],
      proposerTitle: 'Design chat', planStepCount: 2
    } });
    // The source policy is passed so the capability is checked against the realpath it issues.
    expect(issueSources).toHaveBeenCalledWith(7, 'p1', [join(root, 'proj', 'plan.md')], expect.objectContaining({
      roots: [join(root, 'proj'), homeDir, cloneDir], home: homeDir
    }));
  });
  it('fails the launch cleanly when the registry returns a different number of capabilities', async () => {
    issueSources.mockResolvedValue([]);
    expect(await svc.service.review(7, 'prop-1', allow)).toEqual({
      ok: false, code: 'SOURCE_UNREADABLE', message: 'The source files could not be attached. Try again.'
    });
  });
  it('carries the path of a source outside the project into the composer', async () => {
    writeFileSync(join(homeDir, 'notes.md'), '# notes');
    await svc.service.propose(route, { ...input, sources: ['plan.md', join(homeDir, 'notes.md')] });
    issueSources.mockResolvedValue([
      { id: 'src1', name: 'plan.md', byteSize: 6, expiresAt: 9 },
      { id: 'src2', name: 'notes.md', byteSize: 7, expiresAt: 9 }
    ]);
    const r = await svc.service.review(1, 'prop-2', allow);
    expect(r).toMatchObject({ ok: true, value: { sources: [
      { id: 'src1', name: 'plan.md' },
      { id: 'src2', name: 'notes.md', path: join('~', 'notes.md'), outsideProject: true }
    ] } });
    expect(r.ok && r.value.sources[0]).not.toHaveProperty('outsideProject');
  });
  it('maps infer to freeform', async () => {
    await svc.service.propose(route, { teamId: 'team1', goal: 'g2', planning: 'infer', summary: 'S' });
    issueSources.mockResolvedValue([]);
    const r = await svc.service.review(1, 'prop-2', allow);
    expect(r).toMatchObject({ ok: true, value: { coordinationMode: 'freeform', summary: 'S' } });
  });
  it('hides other projects and unknown ids', async () => {
    expect(code(await svc.service.review(1, 'prop-1', () => false))).toBe('NOT_FOUND');
    expect(code(await svc.service.review(1, 'ghost', allow))).toBe('NOT_FOUND');
    expect(issueSources).not.toHaveBeenCalled();
  });
  it('re-validates against current files', async () => {
    rmSync(join(root, 'proj', 'plan.md'));
    expect(code(await svc.service.review(1, 'prop-1', allow))).toBe('SOURCE_NOT_FILE');
  });
  it('re-validates the plan and the Squad', async () => {
    resolveSquadPlan.mockReturnValue({ planError: 'now broken' });
    expect(await svc.service.review(1, 'prop-1', allow)).toMatchObject({ code: 'INVALID_PLAN' });
    teamRecord.id = 'renamed';
    expect(code(await svc.service.review(1, 'prop-1', allow))).toBe('TEAM_NOT_FOUND');
  });
  it('reports expired and handled proposals', async () => {
    clock += 8 * 24 * 60 * 60 * 1000;
    expect(code(await svc.service.review(1, 'prop-1', allow))).toBe('EXPIRED');
    expect(markUnavailable).toHaveBeenCalledWith(SQUAD_LAUNCH_PROPOSAL_ACTION, 'prop-1', 'This Squad launch proposal expired.');
    expect(code(await svc.service.review(1, 'prop-1', allow))).toBe('EXPIRED');
    await svc.service.propose(route, { teamId: 'team1', goal: 'g2', planning: 'infer' });
    await svc.service.handleAction({ ref: 'prop-2', input: { optionId: 'dismiss' } });
    expect(code(await svc.service.review(1, 'prop-2', allow))).toBe('NOT_PENDING');
  });
  it('maps source registry errors to SOURCE_UNREADABLE with the original code', async () => {
    issueSources.mockRejectedValue(new ExecutionSourceError('SOURCE_CHANGED', 'plan.md changed after selection'));
    expect(await svc.service.review(1, 'prop-1', allow)).toEqual({
      ok: false, code: 'SOURCE_UNREADABLE', message: 'The source files could not be attached (SOURCE_CHANGED): plan.md changed after selection'
    });
    // Anything else (an fs error naming a full path) is logged, never shown.
    issueSources.mockRejectedValue(Object.assign(new Error("ENOENT: no such file, stat '/Users/me/secret'"), { code: 'ENOENT' }));
    expect(await svc.service.review(1, 'prop-1', allow)).toEqual({ ok: false, code: 'SOURCE_UNREADABLE', message: 'The source files could not be attached. Try again.' });
    expect(logError).toHaveBeenCalledWith('squad proposal prop-1 review sources', expect.objectContaining({ code: 'ENOENT' }));
    issueSources.mockRejectedValue('weird');
    expect(await svc.service.review(1, 'prop-1', allow)).toMatchObject({ code: 'SOURCE_UNREADABLE' });
  });
  it('returns a stable message when the review itself fails unexpectedly', async () => {
    vi.spyOn(svc.store, 'get').mockRejectedValueOnce(new Error('ledger at /Users/me/.zcc locked'));
    expect(await svc.service.review(1, 'prop-1', allow)).toEqual({ ok: false, code: 'INVALID', message: 'Opening this Squad launch failed unexpectedly. Try again.' });
    expect(logError).toHaveBeenCalledWith('squad proposal prop-1 review', expect.any(Error));
  });
});

describe('beginLaunch and markLaunched', () => {
  beforeEach(async () => { await svc.service.propose(route, input); });

  it('returns the proposer without changing state', async () => {
    expect(await svc.service.beginLaunch('prop-1', 'p1')).toEqual({
      ok: true, value: { proposal: { id: 'prop-1', proposerKind: 'pty', proposerId: 's1', proposerTitle: 'Design chat' }, sourcePaths: [join(root, 'proj', 'plan.md')] }
    });
    expect((await svc.store.get('prop-1'))?.state).toBe('pending');
  });
  it('hands Launch the reviewed sources, so a goal can add nothing else outside the Project', async () => {
    mkdirSync(join(homeDir, 'vault'));
    const design = join(homeDir, 'vault', 'design.md');
    writeFileSync(design, '# design');
    expect(code(await svc.service.propose(route, { ...input, sources: ['plan.md', design] }))).toBe('ok');
    expect(await svc.service.beginLaunch('prop-2', 'p1')).toMatchObject({ ok: true, value: { sourcePaths: [join(root, 'proj', 'plan.md'), design] } });
  });
  it('rejects wrong project, unknown, launched and expired records', async () => {
    expect(code(await svc.service.beginLaunch('prop-1', 'other'))).toBe('NOT_FOUND');
    expect(code(await svc.service.beginLaunch('ghost', 'p1'))).toBe('NOT_FOUND');
    await svc.service.markLaunched('prop-1', 'exec-1');
    expect(code(await svc.service.beginLaunch('prop-1', 'p1'))).toBe('NOT_PENDING');
    await svc.service.propose(route, { teamId: 'team1', goal: 'g2', planning: 'infer' });
    clock += 8 * 24 * 60 * 60 * 1000;
    expect(code(await svc.service.beginLaunch('prop-2', 'p1'))).toBe('EXPIRED');
  });
  it('holds the proposal for the whole launch, not for a fixed few seconds', async () => {
    expect(code(await svc.service.beginLaunch('prop-1', 'p1'))).toBe('ok');
    expect(code(await svc.service.beginLaunch('prop-1', 'p1'))).toBe('NOT_PENDING');
    clock += 60_000;
    expect(code(await svc.service.beginLaunch('prop-1', 'p1'))).toBe('NOT_PENDING');
    // While it starts, the card can neither be reviewed again nor dismissed.
    expect(code(await svc.service.review(1, 'prop-1', () => true))).toBe('NOT_PENDING');
    await expect(svc.service.handleAction({ ref: 'prop-1', input: { optionId: 'dismiss' } })).rejects.toThrow('This Squad launch is starting.');
    // Only a hung launch is freed, far above any real start time.
    clock += 10 * 60_000;
    expect(code(await svc.service.beginLaunch('prop-1', 'p1'))).toBe('ok');
  });
  it('refuses a second launch when a Squad already started from this proposal, and heals the record', async () => {
    const find = vi.fn(async () => 'exec-earlier');
    const healing = createSquadProposalService({
      store: svc.store, enabled: () => true, lookupProposer: (...a) => lookup(...a),
      projects: { get: () => ({ id: 'p1', name: 'Proj', path: join(root, 'proj') }) },
      teams: { get: () => teamRecord }, personas: { get: (id) => personaMap[id] }, teamHostProblem: () => undefined,
      expandTeamSlots: () => Array.from({ length: slotCount }), resolveSquadPlan: resolveSquadPlan as never,
      fs: realFs, inbox: { appendOnce },
      actions: { bind, markUnavailable }, issueSources, now: () => clock, newId: () => 'unused',
      findLaunchedExecution: find, sourceBases: () => ({ home: homeDir }), logError
    });
    expect(await healing.beginLaunch('prop-1', 'p1')).toMatchObject({ ok: false, code: 'NOT_PENDING', message: 'A Squad was already started from this proposal.' });
    expect(find).toHaveBeenCalledWith('p1', 'prop-1');
    expect(await svc.store.get('prop-1')).toMatchObject({ state: 'launched', executionId: 'exec-earlier' });
    expect(markUnavailable).toHaveBeenCalledWith(SQUAD_LAUNCH_PROPOSAL_ACTION, 'prop-1', expect.stringContaining('Launched as'));
  });
  it('keeps the hold when recording the launch fails, so it cannot launch twice', async () => {
    expect(code(await svc.service.beginLaunch('prop-1', 'p1'))).toBe('ok');
    vi.spyOn(svc.store, 'update').mockRejectedValueOnce(new Error('disk full'));
    await expect(svc.service.markLaunched('prop-1', 'exec-1')).rejects.toThrow('disk full');
    expect(code(await svc.service.beginLaunch('prop-1', 'p1'))).toBe('NOT_PENDING');
  });
  it('never turns a dismissed proposal into a launched one', async () => {
    await svc.service.handleAction({ ref: 'prop-1', input: { optionId: 'dismiss' } });
    await svc.service.markLaunched('prop-1', 'exec-1');
    expect(await svc.store.get('prop-1')).toMatchObject({ state: 'dismissed' });
    expect((await svc.store.get('prop-1'))?.executionId).toBeUndefined();
  });
  it('lets only one of two concurrent Launch presses through', async () => {
    const [first, second] = await Promise.all([svc.service.beginLaunch('prop-1', 'p1'), svc.service.beginLaunch('prop-1', 'p1')]);
    expect([code(first), code(second)].sort()).toEqual(['NOT_PENDING', 'ok']);
  });
  it('releases the hold when the launch check fails, and keeps internals out of the message', async () => {
    vi.spyOn(svc.store, 'get').mockRejectedValueOnce(new Error('ledger at /Users/me/.zcc locked'));
    expect(await svc.service.beginLaunch('prop-1', 'p1')).toEqual({ ok: false, code: 'INVALID', message: 'This Squad launch could not start. Try again.' });
    expect(logError).toHaveBeenCalledWith('squad proposal prop-1 launch', expect.any(Error));
    expect(code(await svc.service.beginLaunch('prop-1', 'p1'))).toBe('ok');
  });
  it('releases the hold after refusing an unknown or handled proposal', async () => {
    expect(code(await svc.service.beginLaunch('prop-1', 'other'))).toBe('NOT_FOUND');
    expect(code(await svc.service.beginLaunch('prop-1', 'p1'))).toBe('ok');
  });
  it('lets the user retry at once after a failed start', async () => {
    await svc.service.beginLaunch('prop-1', 'p1');
    svc.service.releaseLaunch('prop-1');
    expect(code(await svc.service.beginLaunch('prop-1', 'p1'))).toBe('ok');
  });
  it('marks launched with the exact card message', async () => {
    await svc.service.markLaunched('prop-1', 'exec-1');
    expect(await svc.store.get('prop-1')).toMatchObject({ state: 'launched', executionId: 'exec-1' });
    expect(markUnavailable).toHaveBeenCalledWith(SQUAD_LAUNCH_PROPOSAL_ACTION, 'prop-1', 'Launched as "Build the thing". Open it from the Agents board.');
  });
  it('tolerates unknown ids and a missing card', async () => {
    await svc.service.markLaunched('ghost', 'e');
    expect(markUnavailable).not.toHaveBeenCalled();
    markUnavailable.mockImplementation(() => { throw new Error('gone'); });
    await expect(svc.service.markLaunched('prop-1', 'e')).resolves.toBeUndefined();
  });
});

describe('sweepExpired', () => {
  it('expires due proposals once and tolerates missing cards', async () => {
    await svc.service.propose(route, { teamId: 'team1', goal: 'a', planning: 'infer' });
    await svc.service.propose(route, { teamId: 'team1', goal: 'b', planning: 'infer' });
    expect(await svc.service.sweepExpired()).toBe(0);
    clock += 8 * 24 * 60 * 60 * 1000;
    markUnavailable.mockImplementation(() => { throw new Error('gone'); });
    expect(await svc.service.sweepExpired()).toBe(2);
    expect(markUnavailable).toHaveBeenCalledTimes(2);
    expect(await svc.service.sweepExpired()).toBe(0);
  });
});

describe('links into protected locations', () => {
  const fs = realFs;
  const proj = () => join(root, 'proj');
  let scope: SquadSourceScope;
  beforeEach(async () => {
    scope = (await sourceScope(fs, proj(), { home: homeDir, cloneRoot: cloneDir }))!;
    mkdirSync(join(homeDir, '.ssh'));
    mkdirSync(join(homeDir, 'dotfiles', 'ssh'), { recursive: true });
    writeFileSync(join(homeDir, 'dotfiles', 'ssh', 'id_rsa'), 'PRIVATE');
    // A dotfiles setup that links one file, not the folder: its realpath is an unprotected path.
    symlinkSync(join(homeDir, 'dotfiles', 'ssh', 'id_rsa'), join(homeDir, '.ssh', 'id_rsa'));
  });

  it('refuses a per-file link inside a protected folder, and a link from a normal file to it', async () => {
    symlinkSync(join(homeDir, '.ssh', 'id_rsa'), join(homeDir, 'notes.md'));
    symlinkSync(join(homeDir, '.ssh', 'id_rsa'), join(proj(), 'key.md'));
    expect(await confineSource(fs, scope, join(homeDir, '.ssh', 'id_rsa'))).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED', message: expect.stringContaining('protected location') });
    expect(await confineSource(fs, scope, join(homeDir, 'notes.md'))).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED' });
    expect(await confineSource(fs, scope, 'key.md')).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED' });
    // The same policy gates squad_plan_check, goal paths and the reader.
    expect(code(await svc.service.checkPlan(route, { path: join(homeDir, 'notes.md') }))).toBe('SOURCE_NOT_ALLOWED');
    expect(await goalPathNotAllowed(fs, scope, `Read ${join(homeDir, 'notes.md')}`)).toEqual({ path: join(homeDir, 'notes.md'), reason: 'policy' });
    expect(code(await svc.service.propose(route, { ...input, sources: [join(homeDir, 'notes.md')] }))).toBe('SOURCE_NOT_ALLOWED');
  });

  it('still follows an ordinary link between two allowed locations', async () => {
    mkdirSync(join(homeDir, 'vault'));
    writeFileSync(join(homeDir, 'vault', 'design.md'), '# design');
    symlinkSync(join(homeDir, 'vault', 'design.md'), join(proj(), 'design.md'));
    expect(await confineSource(fs, scope, 'design.md')).toMatchObject({ ok: true, source: { outsideProject: true } });
  });

  it('refuses a link loop cleanly, with the policy text', async () => {
    symlinkSync(join(proj(), 'loop-b'), join(proj(), 'loop-a'));
    symlinkSync(join(proj(), 'loop-a'), join(proj(), 'loop-b'));
    // realpath fails on a loop: not a file.
    expect(await confineSource(fs, scope, 'loop-a')).toMatchObject({ ok: false, code: 'SOURCE_NOT_FILE' });
    // A chain longer than the hop limit that realpath can resolve (a fake realpath) is refused by the walk.
    const links: Record<string, string> = {};
    for (let i = 0; i < 60; i += 1) links[join(proj(), `l${i}`)] = join(proj(), `l${i + 1}`);
    const fake: SquadProposalFs = {
      ...fs,
      realpath: async (p) => (p in links ? join(proj(), 'plan.md') : fsp.realpath(p)),
      lstat: async (p) => (p in links ? { ...(await fsp.lstat(join(proj(), 'plan.md'))), isSymbolicLink: () => true } : fsp.lstat(p)),
      readlink: async (p) => links[p]!
    };
    const refused = await confineSource(fake, scope, 'l0');
    expect(refused).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED', message: expect.stringContaining('too many links') });
  });
});

describe('Project inside a newly protected root', () => {
  const fs = realFs;
  let projectDir: string;
  beforeEach(() => {
    projectDir = join(homeDir, '.claude', 'projects', 'p', 'memory');
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'MEMORY.md'), '# memory');
    mkdirSync(join(homeDir, '.claude', 'projects', 'other'), { recursive: true });
    writeFileSync(join(homeDir, '.claude', 'projects', 'other', 's.jsonl'), '{}');
    mkdirSync(join(homeDir, '.ssh'));
    writeFileSync(join(homeDir, '.ssh', 'id_rsa'), 'PRIVATE');
  });

  it('keeps the Project\'s own files, and refuses the newer credential entries outside it', async () => {
    const scope = (await sourceScope(fs, join(homeDir, '.claude', 'projects', 'p'), { home: homeDir }))!;
    expect(await confineSource(fs, scope, join('memory', 'MEMORY.md'))).toMatchObject({ ok: true, source: { relPath: join('memory', 'MEMORY.md') } });
    expect(await goalPathNotAllowed(fs, scope, `Use ${join(projectDir, 'MEMORY.md')}`)).toBeUndefined();
    expect(await confineSource(fs, scope, join(homeDir, '.claude', 'projects', 'other', 's.jsonl'))).toMatchObject({ code: 'SOURCE_NOT_ALLOWED', message: expect.stringContaining('protected location') });
    // ~/.ssh stays refused wherever it is.
    expect(await confineSource(fs, scope, join(homeDir, '.ssh', 'id_rsa'))).toMatchObject({ code: 'SOURCE_NOT_ALLOWED' });
  });
});

describe('a registered Project whose folder is gone', () => {
  const gone = () => { rmSync(join(root, 'proj'), { recursive: true }); };

  it('refuses sources and plan files, but still proposes and reviews a plan in the goal', async () => {
    gone();
    expect(await svc.service.propose(route, input)).toMatchObject({ ok: false, code: 'NOT_FOUND', message: 'The project folder is not available.' });
    expect(code(await svc.service.checkPlan(route, { path: 'plan.md' }))).toBe('NOT_FOUND');
    expect(code(await svc.service.checkPlan(route, { text: 'inline' }))).toBe('ok');
    // No sources and no goal path to check: nothing needs the folder, so there is no scope.
    expect(code(await svc.service.propose(route, { ...input, sources: [] }))).toBe('ok');
    const reviewed = await svc.service.review(3, 'prop-1', () => true);
    expect(reviewed).toMatchObject({ ok: true, value: { proposalId: 'prop-1', sources: [] } });
    expect(issueSources).not.toHaveBeenCalled();
  });
});

describe('goal path edge cases', () => {
  it('ignores a goal path whose lstat fails (Launch ignores what it cannot stat)', async () => {
    const scope = (await sourceScope(realFs, join(root, 'proj'), { home: homeDir }))!;
    const broken: SquadProposalFs = { ...realFs, lstat: async () => { throw new Error('EIO'); } };
    expect(await goalPathNotAllowed(broken, scope, `Read ${join(root, 'proj', 'plan.md')}`)).toBeUndefined();
  });
});

describe('goal paths and the reviewed card', () => {
  let design: string;
  beforeEach(() => {
    mkdirSync(join(homeDir, 'vault'));
    design = join(homeDir, 'vault', 'design.md');
    writeFileSync(design, '# design');
  });

  it('accepts a goal that names an outside file the proposal also lists in sources', async () => {
    expect(code(await svc.service.propose(route, { ...input, goal: `Summarise ${design}`, sources: [design] }))).toBe('ok');
  });

  it('still refuses an outside file the goal names when sources list a different one', async () => {
    writeFileSync(join(homeDir, 'vault', 'other.md'), '# other');
    const r = await svc.service.propose(route, { ...input, goal: `Summarise ${design}`, sources: [join(homeDir, 'vault', 'other.md')] });
    expect(r).toMatchObject({ ok: false, code: 'SOURCE_NOT_ALLOWED', message: expect.stringContaining('Pass it in sources') });
  });

  it('refuses a goal path when the project folder is gone, as it cannot be checked and Launch would discover it', async () => {
    rmSync(join(root, 'proj'), { recursive: true });
    const r = await svc.service.propose(route, { ...input, sources: [], goal: `Summarise ${design}` });
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND', message: expect.stringContaining("paths named in the goal can't be checked") });
    expect(appendOnce).not.toHaveBeenCalled();
  });

  it('judges only files: a goal naming a folder, the Project root or HOME itself is ignored, as Launch ignores them', async () => {
    mkdirSync(join(homeDir, '.ssh'));
    const scope = (await sourceScope(realFs, join(root, 'proj'), { home: homeDir }))!;
    for (const folder of [join(root, 'proj'), homeDir, join(homeDir, '.ssh'), join(homeDir, 'vault'), outside]) {
      expect(await goalPathNotAllowed(realFs, scope, `Look in ${folder}`), folder).toBeUndefined();
    }
    // A file in the same places is still judged.
    writeFileSync(join(homeDir, '.ssh', 'id_rsa'), 'PRIVATE');
    expect(await goalPathNotAllowed(realFs, scope, `Look in ${join(homeDir, '.ssh', 'id_rsa')}`)).toMatchObject({ reason: 'policy' });
    expect(await goalPathNotAllowed(realFs, scope, `Look in ${design}`)).toMatchObject({ reason: 'outside-project' });
    expect(await goalPathNotAllowed(realFs, scope, `Look in ${design}`, new Set([design]))).toBeUndefined();
  });

  it('reads the same path tokens as the host: quoted, unquoted, with trailing punctuation', () => {
    expect(goalPathTokens('See "/a b/c.md", /d/e.md; and (/f/g.md). Not a/path.')).toEqual(['/a b/c.md', '/d/e.md', '/f/g.md']);
    expect(goalPathTokens('nothing here')).toEqual([]);
  });

  it('reads @mentions like the host: absolute always, relative only against a project root', () => {
    expect(goalPathTokens('Run @/v/plan.md and (@docs/a.md).')).toEqual(['/v/plan.md']);
    expect(goalPathTokens('Run @/v/plan.md and (@docs/a.md).', '/p')).toEqual(['/v/plan.md', '/p/docs/a.md']);
  });

  it('reads an absolute Windows @mention whole, drive colon included', () => {
    const goal = 'Run @C:\\plans\\plan.md, @D:/x/y.md and @C';
    expect(goalMentionPaths(goal)).toEqual(['C:\\plans\\plan.md', 'D:/x/y.md']);
    expect(goalMentionPaths(goal, '/p')).toEqual(['C:\\plans\\plan.md', 'D:/x/y.md', '/p/C']);
    expect(goalPathTokens(goal)).toEqual(['C:\\plans\\plan.md', 'D:/x/y.md']);
  });

  it('judges a relative @mention against the Project: inside passes, an escape is refused', async () => {
    const scope = (await sourceScope(realFs, join(root, 'proj'), { home: homeDir }))!;
    writeFileSync(join(root, 'proj', 'a-recoverable.md'), '# plan');
    expect(await goalPathNotAllowed(realFs, scope, '@a-recoverable.md')).toBeUndefined();
    const outside = relative(join(root, 'proj'), design);
    expect(await goalPathNotAllowed(realFs, scope, `@${outside}`)).toEqual({ path: design, reason: 'outside-project' });
  });
});
