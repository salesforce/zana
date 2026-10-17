import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import * as fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Persona, Team } from '@zana-ai/zcc-domain/product';
import { InboxActionOperatorError } from '../inbox-actions/registry.js';
import { createSquadProposalStore } from './store.js';
import {
  SQUAD_LAUNCH_PROPOSAL_ACTION,
  confineToProject,
  createSquadProposalService,
  type SquadProposalServiceDeps
} from './service.js';

let root: string;
let outside: string;
let clock: number;
let ids: number;
let lookup: SquadProposalServiceDeps['lookupProposer'];
const appendOnce = vi.fn();
const bind = vi.fn();
const markUnavailable = vi.fn();
const issueSources = vi.fn();
const resolveSquadPlan = vi.fn();

const writer: Persona = { id: 'orch', name: 'Lead' } as Persona;
const reader: Persona = { id: 'ro', name: 'Planner', deniedTools: ['Write', 'Edit'] } as Persona;
let teamRecord: Team;
let personaMap: Record<string, Persona>;
let hostProblem: string | undefined;
let slotCount: number;
let projectOk: boolean;
let readFails: boolean;
let enabledFlag: boolean;

function build() {
  const store = createSquadProposalStore({ filePath: join(root, 'state', 'squad-proposals.json'), now: () => clock });
  const service = createSquadProposalService({
    store,
    enabled: () => enabledFlag,
    lookupProposer: (...a) => lookup(...a),
    projects: { get: (id) => (id === 'p1' && projectOk ? { id: 'p1', name: 'Proj', path: join(root, 'proj') } : undefined) },
    teams: { get: (id) => (id === teamRecord.id ? teamRecord : undefined) },
    personas: { get: (id) => personaMap[id] },
    teamHostProblem: () => hostProblem,
    expandTeamSlots: () => Array.from({ length: slotCount }),
    resolveSquadPlan: resolveSquadPlan as never,
    fs: { realpath: fsp.realpath, lstat: fsp.lstat, readFile: (p, e) => (readFails ? Promise.reject(new Error('EIO')) : fsp.readFile(p, e)) },
    inbox: { appendOnce },
    actions: { bind, markUnavailable },
    issueSources,
    now: () => clock,
    newId: () => `prop-${++ids}`
  });
  return { store, service, deps: undefined };
}

const route = { projectId: 'p1', sessionId: 's1' };
const input = { teamId: 'team1', goal: 'Build the thing\nwith details', planning: 'provided' as const, sources: ['plan.md'] };
let svc: ReturnType<typeof build>;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'squad-service-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'squad-outside-')));
  mkdirSync(join(root, 'proj', 'docs'), { recursive: true });
  writeFileSync(join(root, 'proj', 'plan.md'), '# plan');
  writeFileSync(join(outside, 'secret.md'), 'x');
  clock = 1000;
  ids = 0;
  enabledFlag = true;
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
  svc = build();
});

const code = (r: { ok: boolean } & Record<string, unknown>) => (r.ok ? 'ok' : r.code);

describe('confineToProject', () => {
  const fs = { realpath: fsp.realpath, lstat: fsp.lstat, readFile: (p: string, e: 'utf8') => fsp.readFile(p, e) };
  const proj = () => join(root, 'proj');

  it('accepts relative and absolute paths inside the project', async () => {
    const rel = await confineToProject(fs, proj(), 'plan.md');
    expect(rel).toMatchObject({ ok: true, source: { relPath: 'plan.md', bytes: 6, path: join(proj(), 'plan.md') } });
    expect(await confineToProject(fs, proj(), join(proj(), 'plan.md'))).toMatchObject({ ok: true });
  });
  it('rejects escapes, symlinks, directories, the root itself and missing files', async () => {
    expect(await confineToProject(fs, proj(), relative(join(root, 'proj'), join(outside, 'secret.md')))).toMatchObject({ code: 'SOURCE_OUTSIDE_PROJECT' });
    expect(await confineToProject(fs, proj(), join(outside, 'secret.md'))).toMatchObject({ code: 'SOURCE_OUTSIDE_PROJECT' });
    symlinkSync(join(outside, 'secret.md'), join(proj(), 'link.md'));
    expect(await confineToProject(fs, proj(), 'link.md')).toMatchObject({ code: 'SOURCE_OUTSIDE_PROJECT' });
    expect(await confineToProject(fs, proj(), 'docs')).toMatchObject({ code: 'SOURCE_NOT_FILE' });
    expect(await confineToProject(fs, proj(), '.')).toMatchObject({ code: 'SOURCE_OUTSIDE_PROJECT' });
    expect(await confineToProject(fs, proj(), 'nope.md')).toMatchObject({ code: 'SOURCE_NOT_FILE' });
    expect(await confineToProject(fs, join(root, 'gone'), 'x')).toMatchObject({ code: 'NOT_FOUND' });
  });
  it('accepts a file whose name merely starts with two dots', async () => {
    writeFileSync(join(proj(), '..notes.md'), 'x');
    expect(await confineToProject(fs, proj(), '..notes.md')).toMatchObject({ ok: true, source: { relPath: '..notes.md' } });
  });
  it('reports an lstat failure as not a file', async () => {
    const broken = { ...fs, lstat: async () => { throw new Error('x'); } };
    expect(await confineToProject(broken, proj(), 'plan.md')).toMatchObject({ code: 'SOURCE_NOT_FILE' });
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
      { summary: 'x'.repeat(2049) }, { sources: 'plan.md' }, { sources: [''] }]) {
      expect(code(await run(bad))).toBe('INVALID');
    }
    expect(code(await svc.service.propose(route, null as never))).toBe('INVALID');

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
    expect(code(await run({ sources: [relative(join(root, 'proj'), join(outside, 'secret.md'))] }))).toBe('SOURCE_OUTSIDE_PROJECT');
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
    expect(r).toMatchObject({ ok: false, code: 'SOURCE_OUTSIDE_PROJECT', message: expect.stringContaining('secret.md') });
    expect(appendOnce).not.toHaveBeenCalled();
    const quoted = await svc.service.propose(route, { ...input, goal: `Use "${join(outside, 'secret.md')}".` });
    expect(code(quoted)).toBe('SOURCE_OUTSIDE_PROJECT');
  });

  it('accepts goal paths inside the project and ignores paths that do not exist', async () => {
    expect(code(await svc.service.propose(route, { ...input, goal: `Follow ${join(root, 'proj', 'plan.md')}.` }))).toBe('ok');
    expect(code(await svc.service.propose(route, { ...input, goal: 'See /no/such/file.md and (/also/missing)' }))).toBe('ok');
  });

  it('fails cleanly when the Inbox card action cannot be bound', async () => {
    bind.mockReturnValue(false);
    const r = await svc.service.propose(route, input);
    expect(r).toMatchObject({ ok: false, code: 'INVALID', message: expect.stringContaining('could not be registered') });
    expect(await svc.store.listPending('p1')).toHaveLength(0);
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
    expect((await svc.store.get('prop-1'))?.state).toBe('dismissed');
  });

  it('truncates a long first line to 80 chars', async () => {
    await svc.service.propose(route, { teamId: 'team1', goal: 'y'.repeat(200), planning: 'infer' });
    expect((await svc.store.get('prop-1'))?.title).toHaveLength(80);
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
    expect(code(await s.checkPlan(route, { path: join(outside, 'secret.md') }))).toBe('SOURCE_OUTSIDE_PROJECT');
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
    // The project root is passed so the capability is confined against the realpath it issues.
    expect(issueSources).toHaveBeenCalledWith(7, 'p1', [join(root, 'proj', 'plan.md')], join(root, 'proj'));
  });
  it('maps infer to freeform', async () => {
    await svc.service.propose(route, { teamId: 'team1', goal: 'g2', planning: 'infer', summary: 'S' });
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
    issueSources.mockRejectedValue(Object.assign(new Error('file changed'), { code: 'SOURCE_CHANGED' }));
    const r = await svc.service.review(1, 'prop-1', allow);
    expect(r).toMatchObject({ ok: false, code: 'SOURCE_UNREADABLE' });
    expect(!r.ok && r.message).toContain('SOURCE_CHANGED');
    issueSources.mockRejectedValue('weird');
    expect(await svc.service.review(1, 'prop-1', allow)).toMatchObject({ code: 'SOURCE_UNREADABLE' });
  });
});

describe('beginLaunch and markLaunched', () => {
  beforeEach(async () => { await svc.service.propose(route, input); });

  it('returns the proposer without changing state', async () => {
    expect(await svc.service.beginLaunch('prop-1', 'p1')).toEqual({
      ok: true, value: { proposal: { id: 'prop-1', proposerKind: 'pty', proposerId: 's1', proposerTitle: 'Design chat' } }
    });
    expect((await svc.store.get('prop-1'))?.state).toBe('pending');
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
      fs: { realpath: fsp.realpath, lstat: fsp.lstat, readFile: fsp.readFile }, inbox: { appendOnce },
      actions: { bind, markUnavailable }, issueSources, now: () => clock, newId: () => 'unused',
      findLaunchedExecution: find
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
