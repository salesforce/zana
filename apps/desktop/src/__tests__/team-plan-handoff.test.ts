import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, lstat, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const fsHook = vi.hoisted(() => ({ open: undefined as undefined | ((...args: unknown[]) => Promise<unknown>) }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, open: (...args: Parameters<typeof actual.open>) => fsHook.open ? fsHook.open(...args) : actual.open(...args) };
});
import type { ExecutionWorkUnitInput } from '@zana-ai/zcc-server/services/execution/store';
import {
  MAX_HANDOFF_FILE_BYTES,
  PLAN_TRACE_REASON_MAX,
  TeamPlanHandoff,
  authoredPlanRelPath,
  boundTraceReason,
  createPlanTraceSink,
  planBodyDigest,
  planUnitsDigest,
  correctedPlanRelPath,
  cleanupHandoffFiles,
  readAuthoredPlan,
  readCorrectedPlan,
  readHandoffArtifact,
  sourceMirrorRelPath,
  writeSourceMirror,
  type AuthoredPlanRead,
  type CoordinatorHandoffContext,
  type PlanHandoffTrace
} from '../team-plan-handoff.js';
import { createInferredPlanCorrection } from '../inferred-plan-correction.js';
import { PlanCorrectionService } from '../plan-correction/service.js';
import { PlanCorrectionLaunchBinding } from '../plan-correction/launch-binding.js';

const VALID_PLAN = [
  '### home: Write Home <!-- executable-step -->',
  '',
  '- **Depends on:** None',
  '- **Mode:** Mutating',
  '- **Write scope:** `home.txt`',
  '- **Work:** Create `home.txt`.',
  '- **Verification:** Read it back.',
  ''
].join('\n');

describe('readAuthoredPlan / writeSourceMirror (filesystem)', () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'zana-handoff-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('returns missing when no file exists', async () => {
    expect(await readAuthoredPlan(root, 'exec-1')).toEqual({ status: 'missing' });
  });

  it('parses + normalizes a valid authored plan file', async () => {
    await mkdir(join(root, '.zana'), { recursive: true });
    await writeFile(join(root, authoredPlanRelPath('exec-1')), VALID_PLAN, 'utf8');
    const read = await readAuthoredPlan(root, 'exec-1');
    expect(read.status).toBe('ok');
    if (read.status !== 'ok') return;
    expect(read.units).toHaveLength(1);
    expect(read.units[0]).toMatchObject({ id: 'home', files: ['home.txt'], verification: ['Read it back.'] });
  });

  it('reads a corrected plan from its separate handoff path', async () => {
    await mkdir(join(root, '.zana'), { recursive: true });
    await writeFile(join(root, correctedPlanRelPath('exec-1')), VALID_PLAN, 'utf8');
    expect((await readCorrectedPlan(root, 'exec-1')).status).toBe('ok');
    expect(await readAuthoredPlan(root, 'exec-1')).toEqual({ status: 'missing' });
  });

  it('omits normalizations for a clean plan and reports them for a recoverable one', async () => {
    await mkdir(join(root, '.zana'), { recursive: true });
    await writeFile(join(root, authoredPlanRelPath('exec-1')), VALID_PLAN, 'utf8');
    expect(await readAuthoredPlan(root, 'exec-1')).not.toHaveProperty('normalizations');
    await writeFile(join(root, authoredPlanRelPath('exec-1')), VALID_PLAN.replace('### home:', '### Home:'), 'utf8');
    const read = await readAuthoredPlan(root, 'exec-1');
    expect(read).toMatchObject({ status: 'ok', normalizations: ['step "Home" id normalized to "home"'] });
    if (read.status === 'ok') expect(read.units[0].id).toBe('home');
  });

  it('returns invalid (with reason) for a present-but-incomplete plan', async () => {
    await mkdir(join(root, '.zana'), { recursive: true });
    // Mutating step with no Write scope fails DAG completeness normalization.
    const bad = '### x: X <!-- executable-step -->\n\n- **Mode:** Mutating\n- **Work:** do x\n- **Verification:** check\n';
    await writeFile(join(root, authoredPlanRelPath('exec-1')), bad, 'utf8');
    const read = await readAuthoredPlan(root, 'exec-1');
    expect(read.status).toBe('invalid');
  });

  it('rejects an oversize plan file', async () => {
    await mkdir(join(root, '.zana'), { recursive: true });
    await writeFile(join(root, authoredPlanRelPath('exec-1')), 'x'.repeat(MAX_HANDOFF_FILE_BYTES + 1), 'utf8');
    const read = await readAuthoredPlan(root, 'exec-1');
    expect(read).toMatchObject({ status: 'invalid' });
    if (read.status === 'invalid') expect(read.reason).toContain('exceeds');
  });

  it('sanitizes the executionId into the confined path (no traversal)', () => {
    // A hostile id cannot escape `.zana/` — separators are replaced.
    expect(authoredPlanRelPath('../../etc/passwd')).toBe('.zana/execution-plan-______etc_passwd.md');
    expect(sourceMirrorRelPath('a/b')).toBe('.zana/execution-source-a_b.md');
  });

  it('mirrors sources round-trips through the confined file, then cleans up', async () => {
    const rel = await writeSourceMirror(root, 'exec-1', [{ name: 'plan.md', extractedText: 'REQUIREMENTS BODY' }]);
    expect(rel).toBe(sourceMirrorRelPath('exec-1'));
    const body = await readFile(join(root, rel!), 'utf8');
    expect(body).toContain('## plan.md');
    expect(body).toContain('REQUIREMENTS BODY');
    await cleanupHandoffFiles(root, 'exec-1');
    await expect(readFile(join(root, rel!), 'utf8')).rejects.toThrow();
  });

  it('no-ops the source mirror when there is nothing to write', async () => {
    expect(await writeSourceMirror(root, 'exec-1', [])).toBeUndefined();
    expect(await writeSourceMirror(root, 'exec-1', [{ extractedText: '   ' }])).toBeUndefined();
  });

  it('truncates an oversize source mirror with a visible marker', async () => {
    const rel = await writeSourceMirror(root, 'exec-1', [{ extractedText: 'y'.repeat(MAX_HANDOFF_FILE_BYTES * 2) }]);
    const body = await readFile(join(root, rel!), 'utf8');
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(MAX_HANDOFF_FILE_BYTES);
    expect(body).toContain('TRUNCATED');
  });

  it('keeps the truncated mirror within the byte cap on a multibyte boundary (no U+FFFD)', async () => {
    // '𝕏' is a 4-byte UTF-8 sequence: a naive byte cut would split it and decode
    // to the 3-byte replacement char, pushing content+marker back over the cap.
    const rel = await writeSourceMirror(root, 'exec-mb', [{ extractedText: '𝕏'.repeat(MAX_HANDOFF_FILE_BYTES) }]);
    const body = await readFile(join(root, rel!), 'utf8');
    expect(Buffer.byteLength(body, 'utf8')).toBeLessThanOrEqual(MAX_HANDOFF_FILE_BYTES);
    expect(body).toContain('TRUNCATED');
    expect(body).not.toContain('�');
  });

});

describe('handoff filesystem confinement (symlink-escape safe)', () => {
  let root: string;
  let outside: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'zana-handoff-root-'));
    outside = await mkdtemp(join(tmpdir(), 'zana-handoff-outside-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('writeSourceMirror refuses a symlinked .zana parent that escapes projectRoot', async () => {
    // `.zana` is a symlink to a dir OUTSIDE the project — a lexical containment
    // check passes but following the link would write outside projectRoot.
    await symlink(outside, join(root, '.zana'), 'dir');
    const rel = await writeSourceMirror(root, 'exec-1', [{ extractedText: 'poison' }]);
    expect(rel).toBeUndefined();
    await expect(readFile(join(outside, 'execution-source-exec-1.md'), 'utf8')).rejects.toThrow();
  });

  it('writeSourceMirror replaces a leaf symlink instead of clobbering its target', async () => {
    await mkdir(join(root, '.zana'), { recursive: true });
    await writeFile(join(outside, 'victim.md'), 'SECRET', 'utf8');
    const leaf = join(root, sourceMirrorRelPath('exec-1'));
    await symlink(join(outside, 'victim.md'), leaf, 'file');
    const rel = await writeSourceMirror(root, 'exec-1', [{ extractedText: 'poison' }]);
    expect(rel).toBe(sourceMirrorRelPath('exec-1'));
    // The victim outside the project is untouched...
    expect(await readFile(join(outside, 'victim.md'), 'utf8')).toBe('SECRET');
    // ...and the leaf is now a regular confined file, not the symlink.
    expect((await lstat(leaf)).isSymbolicLink()).toBe(false);
    expect(await readFile(leaf, 'utf8')).toContain('poison');
  });

  it('cleanupHandoffFiles refuses a symlinked .zana parent that escapes projectRoot', async () => {
    await symlink(outside, join(root, '.zana'), 'dir');
    await writeFile(join(outside, 'execution-plan-exec-1.md'), 'VICTIM', 'utf8');
    await writeFile(join(outside, 'execution-source-exec-1.md'), 'VICTIM2', 'utf8');
    await cleanupHandoffFiles(root, 'exec-1');
    expect(await readFile(join(outside, 'execution-plan-exec-1.md'), 'utf8')).toBe('VICTIM');
    expect(await readFile(join(outside, 'execution-source-exec-1.md'), 'utf8')).toBe('VICTIM2');
  });

  it('readAuthoredPlan treats a leaf symlink as missing (no-follow)', async () => {
    await mkdir(join(root, '.zana'), { recursive: true });
    await writeFile(join(outside, 'victim-plan.md'), VALID_PLAN, 'utf8');
    // resolveContainedReal realpaths the leaf out of the project → missing; even
    // if it were in-project, O_NOFOLLOW refuses to open a leaf symlink.
    await symlink(join(outside, 'victim-plan.md'), join(root, authoredPlanRelPath('exec-1')), 'file');
    expect(await readAuthoredPlan(root, 'exec-1')).toEqual({ status: 'missing' });
  });
});

describe('TeamPlanHandoff.onCoordinatorIdle', () => {
  const ctx: CoordinatorHandoffContext = {
    sessionId: 's-1', projectId: 'p-1', projectRoot: '/root', executionId: 'exec-1', slotId: 'orchestrator:lead'
  };
  const units: ExecutionWorkUnitInput[] = [{ id: 'a', title: 'A', task: 'do a', dependencies: [] }];

  function deps(overrides: Partial<Parameters<typeof makeHandoff>[0]> = {}) {
    return makeHandoff(overrides);
  }
  function makeHandoff(overrides: {
    isPlanless?: (p: string, e: string) => Promise<boolean>;
    readAuthoredPlan?: () => Promise<AuthoredPlanRead>;
    register?: () => Promise<{ ok: boolean; message?: string }>;
    maxNudges?: number;
  } = {}) {
    const nudge = vi.fn();
    const register = vi.fn(overrides.register ?? (async () => ({ ok: true })));
    const cleanup = vi.fn(async () => {});
    const handoff = new TeamPlanHandoff({
      isPlanless: overrides.isPlanless ?? (async () => true),
      readAuthoredPlan: overrides.readAuthoredPlan ?? (async () => ({ status: 'ok', units, realPath: '/root/.zana/execution-plan-exec-1.md' })),
      register,
      nudge,
      cleanup,
      logError: () => {},
      maxNudges: overrides.maxNudges
    });
    return { handoff, nudge, register, cleanup };
  }

  it('registers a valid authored plan host-side and cleans up, once', async () => {
    const { handoff, register, cleanup, nudge } = deps();
    await handoff.onCoordinatorIdle(ctx);
    expect(register).toHaveBeenCalledOnce();
    expect(register).toHaveBeenCalledWith(ctx, units);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(nudge).not.toHaveBeenCalled();
    // A second idle after success is a no-op (done latch).
    await handoff.onCoordinatorIdle(ctx);
    expect(register).toHaveBeenCalledOnce();
  });

  it('no-ops when the execution already has a plan', async () => {
    const { handoff, register, nudge } = deps({ isPlanless: async () => false });
    await handoff.onCoordinatorIdle(ctx);
    expect(register).not.toHaveBeenCalled();
    expect(nudge).not.toHaveBeenCalled();
  });

  it('nudges with the reason when the plan file is missing', async () => {
    const { handoff, nudge, register } = deps({ readAuthoredPlan: async () => ({ status: 'missing' }) });
    await handoff.onCoordinatorIdle(ctx);
    expect(register).not.toHaveBeenCalled();
    expect(nudge).toHaveBeenCalledOnce();
    expect(nudge.mock.calls[0][1]).toContain(authoredPlanRelPath('exec-1'));
  });

  it('nudges with the validation reason when the plan file is invalid', async () => {
    const { handoff, nudge } = deps({ readAuthoredPlan: async () => ({ status: 'invalid', reason: 'work unit requires verification' }) });
    await handoff.onCoordinatorIdle(ctx);
    expect(nudge.mock.calls[0][1]).toContain('work unit requires verification');
  });

  it('lets correction handling hold an invalid authored plan before nudging', async () => {
    const reviewInvalid = vi.fn(async () => 'wait' as const);
    const { nudge } = deps({ readAuthoredPlan: async () => ({ status: 'invalid', reason: 'bad plan' }) });
    const guarded = new TeamPlanHandoff({
      isPlanless: async () => true,
      readAuthoredPlan: async () => ({ status: 'invalid', reason: 'bad plan' }),
      reviewInvalid,
      register: async () => ({ ok: true }),
      nudge,
      cleanup: async () => {},
      logError: () => {}
    });
    await guarded.onCoordinatorIdle(ctx);
    expect(reviewInvalid).toHaveBeenCalledWith(ctx, 'bad plan');
    expect(nudge).not.toHaveBeenCalled();
  });

  it('nudges invalid inferred plans when correction handling is unhandled', async () => {
    const reviewInvalid = vi.fn(async () => undefined);
    const nudge = vi.fn();
    const handoff = new TeamPlanHandoff({
      isPlanless: async () => true,
      readAuthoredPlan: async () => ({ status: 'invalid', reason: 'bad inferred plan' }),
      reviewInvalid,
      register: async () => ({ ok: true }),
      nudge,
      cleanup: async () => {},
      logError: () => {}
    });
    await handoff.onCoordinatorIdle(ctx);
    expect(reviewInvalid).toHaveBeenCalledWith(ctx, 'bad inferred plan');
    expect(nudge).toHaveBeenCalledOnce();
  });

  it('nudges when the host rejects the register, without latching done', async () => {
    const { handoff, nudge, register } = deps({ register: async () => ({ ok: false, message: 'budget exceeded' }) });
    await handoff.onCoordinatorIdle(ctx);
    expect(register).toHaveBeenCalledOnce();
    expect(nudge.mock.calls[0][1]).toContain('budget exceeded');
  });

  it('waits for correction review before registering', async () => {
    const nudge = vi.fn();
    const register = vi.fn(async () => ({ ok: true }));
    const handoff = new TeamPlanHandoff({
      isPlanless: async () => true,
      readAuthoredPlan: async () => ({ status: 'ok', units, realPath: '/root/.zana/plan.md' }),
      review: async () => 'wait',
      register,
      nudge,
      cleanup: async () => {},
      logError: () => {}
    });
    await handoff.onCoordinatorIdle(ctx);
    expect(register).not.toHaveBeenCalled();
    expect(nudge).not.toHaveBeenCalled();
  });

  it('registers review-approved replacement units instead of source units', async () => {
    const corrected = [{ id: 'corrected', title: 'Corrected', task: 'do corrected', dependencies: [] }];
    const register = vi.fn(async () => ({ ok: true }));
    const handoff = new TeamPlanHandoff({
      isPlanless: async () => true,
      readAuthoredPlan: async () => ({ status: 'ok', units, realPath: '/root/.zana/plan.md' }),
      review: async () => ({ status: 'ok', units: corrected, realPath: '/root/.zana/corrected.md' }),
      register,
      nudge: () => {},
      cleanup: async () => {},
      logError: () => {}
    });
    await handoff.onCoordinatorIdle(ctx);
    expect(register).toHaveBeenCalledWith(ctx, corrected);
  });

  it('holds provided-invalid launch handoff until human approval for durable executionId', async () => {
    const executionId = 'execution-durable-1';
    const durableCtx = { ...ctx, executionId };
    const appendInbox = vi.fn(async (input) => ({ ...input, id: 'correction-1', ts: 1 }));
    const bindInboxAction = vi.fn(() => true);
    const nudge = vi.fn();
    const corrected = { status: 'ok' as const, units: [{ id: 'corrected', title: 'Corrected', task: 'fix', dependencies: [] }], realPath: '/root/.zana/corrected.md' };
    const records = new Map();
    let handoff: TeamPlanHandoff;
    const correction = new PlanCorrectionService({
      appendInbox,
      bindInboxAction,
      nudge,
      readCorrectedPlan: async () => corrected,
      store: {
        get: async (id) => records.get(id),
        put: async (record) => { records.set(record.executionId, structuredClone(record)); return record; }
      },
      resume: async (resumeCtx) => handoff.onCoordinatorIdle(resumeCtx),
      stopExecution: async () => {}
    });
    const launchBinding = new PlanCorrectionLaunchBinding();
    launchBinding.beginLaunch('launch-request-1', 'provided plan lacks verification');
    // ExecutionService creates durable id, then launchTeam binds it before spawn.
    await expect(launchBinding.bindExecution('launch-request-1', executionId, correction)).resolves.toBe(true);
    await expect(correction.isPending('launch-request-1')).resolves.toBe(false);
    const register = vi.fn(async () => ({ ok: true }));
    handoff = new TeamPlanHandoff({
      isPlanless: async () => true,
      readAuthoredPlan: async () => ({ status: 'ok', units, realPath: '/root/.zana/authored.md' }),
      review: (handoffCtx, read) => correction.review(handoffCtx, read),
      reviewInvalid: (handoffCtx) => correction.reviewInvalid(handoffCtx),
      register,
      nudge,
      cleanup: async () => {},
      logError: () => {}
    });

    await handoff.onCoordinatorIdle(durableCtx);
    expect(appendInbox).toHaveBeenCalledOnce();
    expect(bindInboxAction).toHaveBeenCalledWith(expect.anything(), {
      kind: 'plan-correction',
      ref: expect.stringContaining(`"executionId":"${executionId}"`)
    });
    expect(JSON.parse(bindInboxAction.mock.calls[0][1].ref)).toMatchObject({ executionId, offerId: expect.any(String), digest: expect.any(String) });
    expect(register).not.toHaveBeenCalled();

    const offer = JSON.parse(bindInboxAction.mock.calls[0][1].ref);
    await expect(correction.respond(executionId, 'approve', offer)).resolves.toBe('approve');
    expect(register).toHaveBeenCalledWith(durableCtx, corrected.units);
  });

  it('does not revive a handoff when cancellation queues behind approval persistence', async () => {
    const corrected = { status: 'ok' as const, units: [{ id: 'corrected', title: 'Corrected', task: 'fix', dependencies: [] }], realPath: '/root/.zana/corrected.md' };
    const records = new Map<string, Record<string, unknown>>();
    let releaseApprovalWrite!: () => void;
    let handoff: TeamPlanHandoff;
    const bindInboxAction = vi.fn(() => true);
    const correction = new PlanCorrectionService({
      appendInbox: async (input) => ({ ...input, id: 'correction-1', ts: 1 }),
      bindInboxAction,
      nudge: vi.fn(),
      readCorrectedPlan: async () => corrected,
      store: {
        get: async (id) => records.get(id) as never,
        put: async (record) => {
          if (record.status === 'approved') await new Promise<void>((resolve) => { releaseApprovalWrite = resolve; });
          records.set(record.executionId, structuredClone(record));
          return record;
        }
      },
      resume: async (resumeCtx) => handoff.onCoordinatorIdle(resumeCtx),
      stopExecution: async () => {}
    });
    await correction.begin(ctx.executionId, 'provided plan invalid', false);
    const register = vi.fn(async () => ({ ok: true }));
    handoff = new TeamPlanHandoff({
      isPlanless: async () => true,
      readAuthoredPlan: async () => ({ status: 'invalid', reason: 'still invalid' }),
      reviewInvalid: (handoffCtx) => correction.reviewInvalid(handoffCtx),
      register,
      nudge: vi.fn(),
      cleanup: async () => {},
      logError: () => {}
    });

    await handoff.onCoordinatorIdle(ctx);
    const offer = JSON.parse(bindInboxAction.mock.calls[0][1].ref);
    const approval = correction.respond(ctx.executionId, 'approve', offer);
    await vi.waitFor(() => expect(releaseApprovalWrite).toBeTypeOf('function'));
    const cancellation = correction.respond(ctx.executionId, 'cancel', offer);
    releaseApprovalWrite();

    await expect(cancellation).resolves.toBe('cancelled');
    await expect(approval).resolves.toBe('cancelled');
    expect(register).not.toHaveBeenCalled();
  });

  it('registers approved corrected plan when authored plan remains invalid', async () => {
    const records = new Map();
    const corrected = { status: 'ok' as const, units: [{ id: 'corrected', title: 'Corrected', task: 'fix', dependencies: [] }], realPath: '/root/.zana/corrected.md' };
    const bindInboxAction = vi.fn(() => true);
    const correction = new PlanCorrectionService({
      appendInbox: async (input) => ({ ...input, id: 'correction-1', ts: 1 }),
      bindInboxAction,
      nudge: vi.fn(),
      readCorrectedPlan: async () => corrected,
      store: {
        get: async (id) => records.get(id),
        put: async (record) => { records.set(record.executionId, structuredClone(record)); return record; }
      },
      resume: async () => {},
      stopExecution: async () => {}
    });
    await correction.begin(ctx.executionId, 'provided plan invalid', false);
    const register = vi.fn(async () => ({ ok: true }));
    const handoff = new TeamPlanHandoff({
      isPlanless: async () => true,
      readAuthoredPlan: async () => ({ status: 'invalid', reason: 'still invalid' }),
      reviewInvalid: (handoffCtx) => correction.reviewInvalid(handoffCtx),
      register,
      nudge: vi.fn(),
      cleanup: async () => {},
      logError: () => {}
    });

    await handoff.onCoordinatorIdle(ctx);
    const offer = JSON.parse(bindInboxAction.mock.calls[0][1].ref);
    await correction.respond(ctx.executionId, 'approve', offer);
    await handoff.onCoordinatorIdle(ctx);
    expect(register).toHaveBeenCalledWith(ctx, corrected.units);
  });

  it('stops nudging after maxNudges and defers to the watchdog', async () => {
    const { handoff, nudge } = deps({ readAuthoredPlan: async () => ({ status: 'missing' }), maxNudges: 2 });
    await handoff.onCoordinatorIdle(ctx);
    await handoff.onCoordinatorIdle(ctx);
    await handoff.onCoordinatorIdle(ctx); // budget spent → silent, latches done
    await handoff.onCoordinatorIdle(ctx);
    expect(nudge).toHaveBeenCalledTimes(2);
  });

  it('re-registers after forget() (fresh execution state)', async () => {
    const { handoff, register } = deps();
    await handoff.onCoordinatorIdle(ctx);
    handoff.forget(ctx.executionId);
    await handoff.onCoordinatorIdle(ctx);
    expect(register).toHaveBeenCalledTimes(2);
  });
});

describe('TeamPlanHandoff review verdicts', () => {
  const ctx: CoordinatorHandoffContext = {
    sessionId: 's-1', projectId: 'p-1', projectRoot: '/root', executionId: 'exec-1', slotId: 'orchestrator:lead'
  };
  const units: ExecutionWorkUnitInput[] = [{ id: 'a', title: 'A', task: 'do a', dependencies: [] }];
  const build = (over: Record<string, unknown>, registerResult: { ok: boolean; message?: string } = { ok: true }) => {
    const nudge = vi.fn(), register = vi.fn(async () => registerResult), cleanup = vi.fn(async () => {});
    const handoff = new TeamPlanHandoff({
      isPlanless: async () => true,
      readAuthoredPlan: async () => ({ status: 'ok', units, realPath: '/r' }),
      register, nudge, cleanup, logError: () => {}, ...over
    } as never);
    return { handoff, nudge, register, cleanup };
  };

  it('registers a recoverable-only authored plan once with normalized ids, never review, and logs the repair', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zana-handoff-norm-'));
    try {
      await mkdir(join(root, '.zana'), { recursive: true });
      await writeFile(join(root, authoredPlanRelPath('exec-1')), VALID_PLAN.replace('### home:', '### Home:'), 'utf8');
      const reviewInvalid = vi.fn(async () => 'wait' as const);
      const logInfo = vi.fn(), logError = vi.fn();
      const { handoff, register, cleanup } = build({
        readAuthoredPlan: () => readAuthoredPlan(root, 'exec-1'), reviewInvalid, logInfo, logError
      });
      await handoff.onCoordinatorIdle({ ...ctx, projectRoot: root });
      await handoff.onCoordinatorIdle({ ...ctx, projectRoot: root });
      expect(register).toHaveBeenCalledOnce();
      expect((register.mock.calls[0] as unknown[])[1]).toMatchObject([{ id: 'home' }]);
      expect(reviewInvalid).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledOnce();
      expect(logInfo).toHaveBeenCalledOnce();
      expect(logError).not.toHaveBeenCalled();
      expect(logInfo).toHaveBeenCalledWith(
        'team plan handoff exec-1: registered plan after normalizing',
        'step "Home" id normalized to "home"'
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('joins several repair notes and does not log when registration is rejected', async () => {
    const notes = ['n1', 'n2'];
    const logged = vi.fn();
    const ok = build({ readAuthoredPlan: async () => ({ status: 'ok', units, realPath: '/r', normalizations: notes }), logInfo: logged });
    await ok.handoff.onCoordinatorIdle(ctx);
    expect(logged).toHaveBeenCalledWith(expect.any(String), 'n1; n2');

    const logInfo = vi.fn();
    const rejected = build({ readAuthoredPlan: async () => ({ status: 'ok', units, realPath: '/r', normalizations: notes }), logInfo }, { ok: false });
    await rejected.handoff.onCoordinatorIdle(ctx);
    expect(logInfo).not.toHaveBeenCalled();
  });

  it('does not log for a clean plan', async () => {
    const logInfo = vi.fn();
    const { handoff, register } = build({ logInfo });
    await handoff.onCoordinatorIdle(ctx);
    expect(register).toHaveBeenCalledOnce();
    expect(logInfo).not.toHaveBeenCalled();
  });

  it('does not log when the accepted plan is a corrected-plan verdict without normalizations', async () => {
    const logInfo = vi.fn();
    const { handoff, register } = build({
      readAuthoredPlan: async () => ({ status: 'invalid', reason: 'bad' }),
      reviewInvalid: async () => ({ status: 'ok', units, realPath: '/r' }),
      logInfo
    });
    await handoff.onCoordinatorIdle(ctx);
    expect(register).toHaveBeenCalledOnce();
    expect(logInfo).not.toHaveBeenCalled();
  });

  it('registers a normalized plan without an info logger wired', async () => {
    const { handoff, register, cleanup } = build({ readAuthoredPlan: async () => ({ status: 'ok', units, realPath: '/r', normalizations: ['n1'] }) });
    await handoff.onCoordinatorIdle(ctx);
    expect(register).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('latches done without registering when review rejects the plan', async () => {
    const { handoff, register } = build({ review: async () => 'reject' });
    await handoff.onCoordinatorIdle(ctx);
    await handoff.onCoordinatorIdle(ctx);
    expect(register).not.toHaveBeenCalled();
  });

  it('nudges when the host rejects a reviewed plan, falling back to a generic message', async () => {
    const { handoff, nudge } = build({}, { ok: false });
    await handoff.onCoordinatorIdle(ctx);
    expect(nudge.mock.calls[0][1]).toContain('register failed');
  });

  it('latches done when invalid-plan review rejects', async () => {
    const { handoff, nudge, register } = build({ readAuthoredPlan: async () => ({ status: 'invalid', reason: 'bad' }), reviewInvalid: async () => 'reject' });
    await handoff.onCoordinatorIdle(ctx);
    await handoff.onCoordinatorIdle(ctx);
    expect(register).not.toHaveBeenCalled(); expect(nudge).not.toHaveBeenCalled();
  });

  it('registers a corrected plan supplied by invalid-plan review and cleans up', async () => {
    const { handoff, register, cleanup } = build({
      readAuthoredPlan: async () => ({ status: 'invalid', reason: 'bad' }),
      reviewInvalid: async () => ({ status: 'ok', units, realPath: '/r' })
    });
    await handoff.onCoordinatorIdle(ctx);
    expect(register).toHaveBeenCalledWith(ctx, units);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('nudges when the host rejects a corrected plan, with and without a message', async () => {
    const reviewInvalid = async () => ({ status: 'ok' as const, units, realPath: '/r' });
    const withMsg = build({ readAuthoredPlan: async () => ({ status: 'invalid', reason: 'bad' }), reviewInvalid }, { ok: false, message: 'nope' });
    await withMsg.handoff.onCoordinatorIdle(ctx);
    expect(withMsg.nudge.mock.calls[0][1]).toContain('nope');
    const without = build({ readAuthoredPlan: async () => ({ status: 'invalid', reason: 'bad' }), reviewInvalid }, { ok: false });
    await without.handoff.onCoordinatorIdle(ctx);
    expect(without.nudge.mock.calls[0][1]).toContain('register failed');
  });
});

describe('readHandoffArtifact', () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'zana-artifact-')); await mkdir(join(root, '.zana'), { recursive: true }); });
  afterEach(async () => { vi.restoreAllMocks(); await rm(root, { recursive: true, force: true }); });

  it('reads a file at the cap and rejects oversize, directories and missing files without warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await writeFile(join(root, '.zana/ok.md'), 'x'.repeat(MAX_HANDOFF_FILE_BYTES), 'utf8');
    await writeFile(join(root, '.zana/big.md'), 'x'.repeat(MAX_HANDOFF_FILE_BYTES + 1), 'utf8');
    await writeFile(join(root, '.zana/empty.md'), '', 'utf8');
    await mkdir(join(root, '.zana/dir.md'));
    expect(await readHandoffArtifact(root, '.zana/ok.md')).toHaveLength(MAX_HANDOFF_FILE_BYTES);
    expect(await readHandoffArtifact(root, '.zana/empty.md')).toBe('');
    expect(await readHandoffArtifact(root, '.zana/big.md')).toBeUndefined();
    expect(await readHandoffArtifact(root, '.zana/dir.md')).toBeUndefined();
    expect(await readHandoffArtifact(root, '.zana/missing.md')).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  afterEach(() => { fsHook.open = undefined; });

  it('returns undefined when the file grows past its stat size before the read', async () => {
    const fsp = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    await writeFile(join(root, '.zana/grow.md'), 'abc', 'utf8');
    fsHook.open = async (...args: unknown[]) => {
      const handle = await (fsp.open as (...a: unknown[]) => Promise<import('node:fs/promises').FileHandle>)(...args);
      const stat = handle.stat.bind(handle);
      handle.stat = (async (...a: never[]) => ({ ...(await stat(...a)), isFile: () => true, size: 1 })) as never;
      return handle;
    };
    expect(await readHandoffArtifact(root, '.zana/grow.md')).toBeUndefined();
  });

  it('warns with the relative path on unexpected read errors and still returns undefined', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await writeFile(join(root, '.zana/boom.md'), 'abc', 'utf8');
    fsHook.open = async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
    expect(await readHandoffArtifact(root, '.zana/boom.md')).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('.zana/boom.md'), expect.any(Error));
  });
});

describe('TeamPlanHandoff register rejection routes through plan correction', () => {
  const ctx: CoordinatorHandoffContext = {
    sessionId: 's-1', projectId: 'p-1', projectRoot: '/root', executionId: 'exec-reg', slotId: 'orchestrator:lead'
  };
  const units: ExecutionWorkUnitInput[] = [{ id: 'a', title: 'A', task: 'do a', dependencies: [] }];

  function build(register: () => Promise<{ ok: boolean; message?: string }>) {
    const begun: Array<{ executionId: string; reason: string }> = [];
    let opened = false;
    const correction = createInferredPlanCorrection({
      reviewInvalid: async () => (opened ? 'wait' : undefined),
      begin: async (executionId, reason) => { opened = true; begun.push({ executionId, reason }); }
    });
    const nudge = vi.fn();
    const handoff = new TeamPlanHandoff({
      isPlanless: async () => true,
      readAuthoredPlan: async () => ({ status: 'ok', units, realPath: '/root/.zana/p.md' }),
      reviewInvalid: (c, reason) => correction.reviewInvalid(c, reason),
      register,
      nudge,
      cleanup: async () => {},
      logError: () => {}
    });
    return { handoff, begun, nudge };
  }

  it('opens the correction card with the real register rejection after the strike budget', async () => {
    const { handoff, begun, nudge } = build(async () => ({ ok: false, message: 'cycle detected in DAG' }));
    await handoff.onCoordinatorIdle(ctx);
    await handoff.onCoordinatorIdle(ctx);
    expect(begun).toHaveLength(0);
    expect(nudge).toHaveBeenCalledTimes(2);
    await handoff.onCoordinatorIdle(ctx);
    expect(begun).toEqual([{ executionId: 'exec-reg', reason: expect.stringContaining('cycle detected in DAG') }]);
    // Parked for the Inbox decision: no more nudges, no latching to the watchdog failure.
    await handoff.onCoordinatorIdle(ctx);
    expect(nudge).toHaveBeenCalledTimes(2);
  });

  it('falls back to a generic reason when register gives no message', async () => {
    const { handoff, begun } = build(async () => ({ ok: false }));
    for (let i = 0; i < 3; i++) await handoff.onCoordinatorIdle(ctx);
    expect(begun[0]?.reason).toContain('register failed');
  });

  it('registers the corrected plan an approved correction hands back after a register rejection', async () => {
    const corrected = { status: 'ok' as const, units: [{ id: 'fixed', title: 'F', task: 'f', dependencies: [] }], realPath: '/x' };
    const register = vi.fn()
      .mockResolvedValueOnce({ ok: false, message: 'bad' })
      .mockResolvedValueOnce({ ok: true });
    const handoff = new TeamPlanHandoff({
      isPlanless: async () => true,
      readAuthoredPlan: async () => ({ status: 'ok', units, realPath: '/root/.zana/p.md' }),
      reviewInvalid: async () => corrected,
      register,
      nudge: vi.fn(),
      cleanup: async () => {},
      logError: () => {}
    });
    await handoff.onCoordinatorIdle(ctx);
    expect(register).toHaveBeenLastCalledWith(ctx, corrected.units);
  });

  it('latches done on a reject verdict after a register rejection', async () => {
    const register = vi.fn(async () => ({ ok: false, message: 'bad' }));
    const nudge = vi.fn();
    const handoff = new TeamPlanHandoff({
      isPlanless: async () => true,
      readAuthoredPlan: async () => ({ status: 'ok', units, realPath: '/x' }),
      reviewInvalid: async () => 'reject',
      register,
      nudge,
      cleanup: async () => {},
      logError: () => {}
    });
    await handoff.onCoordinatorIdle(ctx);
    await handoff.onCoordinatorIdle(ctx);
    expect(register).toHaveBeenCalledOnce();
    expect(nudge).not.toHaveBeenCalled();
  });
});

describe('plan handoff correlation trace', () => {
  const traceCtx: CoordinatorHandoffContext = { sessionId: 'sess-1', projectId: 'proj-1', projectRoot: '/root', executionId: 'ui:exec-1', slotId: 'slot-1' };
  const units: ExecutionWorkUnitInput[] = [{ id: 'a', title: 'A', task: 'do a', dependencies: [] }];
  const SECRET_BODY = 'TOP-SECRET-PLAN-BODY sk-live-abc123';

  function traced(overrides: {
    read?: AuthoredPlanRead;
    register?: { ok: boolean; message?: string };
    maxNudges?: number;
    trace?: (event: PlanHandoffTrace) => void;
    review?: ConstructorParameters<typeof TeamPlanHandoff>[0]['review'];
  } = {}) {
    const events: PlanHandoffTrace[] = [];
    const register = vi.fn(async () => overrides.register ?? { ok: true });
    const nudge = vi.fn();
    const handoff = new TeamPlanHandoff({
      isPlanless: async () => true,
      readAuthoredPlan: async () => overrides.read ?? { status: 'ok', units, realPath: '/root/.zana/execution-plan-ui_exec-1.md', bodyDigest: planBodyDigest(SECRET_BODY) },
      register,
      nudge,
      cleanup: async () => {},
      logError: () => {},
      maxNudges: overrides.maxNudges,
      review: overrides.review,
      trace: overrides.trace ?? ((event) => events.push(event))
    });
    return { handoff, events, register, nudge };
  }

  it('digests bodies without carrying them and bounds reasons', () => {
    const digest = planBodyDigest(SECRET_BODY);
    expect(digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digest).not.toContain('SECRET');
    expect(planBodyDigest(SECRET_BODY)).toBe(digest);
    expect(planBodyDigest(`${SECRET_BODY} `)).not.toBe(digest);
    expect(boundTraceReason(undefined)).toBeUndefined();
    expect(boundTraceReason('  a\n\n  b\tc ')).toBe('a b c');
    const long = boundTraceReason('x'.repeat(1000))!;
    expect(long).toHaveLength(PLAN_TRACE_REASON_MAX + 1);
    expect(long.endsWith('…')).toBe(true);
    expect(planUnitsDigest(units)).toBe(planUnitsDigest(units.map((unit) => ({ ...unit }))));
  });

  it('stamps bodyDigest on ok and invalid reads but not on missing or oversize files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zcc-plan-trace-'));
    try {
      expect(await readAuthoredPlan(root, 'exec-1')).toEqual({ status: 'missing' });
      await mkdir(join(root, '.zana'), { recursive: true });
      await writeFile(join(root, authoredPlanRelPath('exec-1')), VALID_PLAN, 'utf8');
      expect(await readAuthoredPlan(root, 'exec-1')).toMatchObject({ status: 'ok', bodyDigest: planBodyDigest(VALID_PLAN) });
      const bad = '### x: X <!-- executable-step -->\n\n- **Mode:** Mutating\n- **Work:** do x\n- **Verification:** check\n';
      await writeFile(join(root, authoredPlanRelPath('exec-1')), bad, 'utf8');
      expect(await readAuthoredPlan(root, 'exec-1')).toMatchObject({ status: 'invalid', bodyDigest: planBodyDigest(bad) });
      await writeFile(join(root, authoredPlanRelPath('exec-1')), 'x'.repeat(MAX_HANDOFF_FILE_BYTES + 1), 'utf8');
      const oversize = await readAuthoredPlan(root, 'exec-1');
      expect(oversize.status).toBe('invalid');
      expect('bodyDigest' in oversize).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('traces read and register with correlation ids, digests, and no plan body', async () => {
    const { handoff, events, register } = traced();
    await handoff.onCoordinatorIdle(traceCtx);
    expect(register).toHaveBeenCalledOnce();
    const base = { executionId: 'ui:exec-1', projectId: 'proj-1', slotId: 'slot-1', sessionId: 'sess-1', path: authoredPlanRelPath('ui:exec-1') };
    expect(events).toEqual([
      { ...base, stage: 'read', status: 'ok', resolvedFile: 'execution-plan-ui_exec-1.md', unitCount: 1, unitsDigest: planUnitsDigest(units), bodyDigest: planBodyDigest(SECRET_BODY) },
      { ...base, stage: 'register', source: 'authored', registered: true, resolvedFile: 'execution-plan-ui_exec-1.md', unitCount: 1, unitsDigest: planUnitsDigest(units), bodyDigest: planBodyDigest(SECRET_BODY) }
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('do a');
    expect(serialized).not.toContain('/root');
  });

  it('traces a corrected register source and a bounded rejection reason', async () => {
    const corrected = { status: 'ok' as const, units: [{ ...units[0], id: 'b' }], realPath: '/root/.zana/execution-plan-corrected-ui_exec-1.md' };
    const { handoff, events } = traced({ review: async () => corrected, register: { ok: false, message: `nope ${'r'.repeat(500)}` } });
    await handoff.onCoordinatorIdle(traceCtx);
    const reg = events.find((event) => event.stage === 'register')!;
    expect(reg).toMatchObject({ source: 'corrected', registered: false, resolvedFile: 'execution-plan-corrected-ui_exec-1.md', unitsDigest: planUnitsDigest(corrected.units) });
    expect('bodyDigest' in reg).toBe(false);
    expect(reg.reason!.length).toBe(PLAN_TRACE_REASON_MAX + 1);
  });

  it('traces an approved register-channel plan as source=register with no file path', async () => {
    const captured = { status: 'ok' as const, units: [{ ...units[0], id: 'c' }], realPath: '.zana/execution-plan-corrected-ui_exec-1.md', origin: 'register' as const };
    const { handoff, events } = traced({ review: async () => captured });
    await handoff.onCoordinatorIdle(traceCtx);
    const reg = events.find((event) => event.stage === 'register')!;
    expect(reg).toEqual({
      executionId: 'ui:exec-1', projectId: 'proj-1', slotId: 'slot-1', sessionId: 'sess-1',
      stage: 'register', source: 'register', registered: true, unitCount: 1, unitsDigest: planUnitsDigest(captured.units)
    });
    expect(JSON.stringify(reg)).not.toContain('corrected');
  });

  it('traces invalid reads, nudges, and exhaustion with bounded reasons', async () => {
    const { handoff, events, nudge } = traced({ read: { status: 'invalid', reason: `bad\n${'z'.repeat(400)}`, bodyDigest: 'sha256:x' }, maxNudges: 1 });
    await handoff.onCoordinatorIdle(traceCtx);
    await handoff.onCoordinatorIdle(traceCtx);
    expect(nudge).toHaveBeenCalledOnce();
    expect(events.map((event) => event.stage)).toEqual(['read', 'nudge', 'read', 'nudge-exhausted']);
    expect(events[0]).toMatchObject({ status: 'invalid', bodyDigest: 'sha256:x' });
    expect(events[0].reason!.startsWith('bad z')).toBe(true);
    expect(events[0].reason!.length).toBe(PLAN_TRACE_REASON_MAX + 1);
    expect(events[1]).toMatchObject({ nudges: 1 });
    expect(events[3]).toMatchObject({ nudges: 1 });
  });

  it('traces a missing read without a body digest or resolved file', async () => {
    const { handoff, events } = traced({ read: { status: 'missing' }, maxNudges: 0 });
    await handoff.onCoordinatorIdle(traceCtx);
    expect(events[0]).toEqual({ executionId: 'ui:exec-1', projectId: 'proj-1', slotId: 'slot-1', sessionId: 'sess-1', path: authoredPlanRelPath('ui:exec-1'), stage: 'read', status: 'missing' });
    expect(events[1].stage).toBe('nudge-exhausted');
  });

  it('a throwing trace sink never changes registration or nudging', async () => {
    const ok = traced({ trace: () => { throw new Error('sink down'); } });
    await ok.handoff.onCoordinatorIdle(traceCtx);
    expect(ok.register).toHaveBeenCalledOnce();
    const bad = traced({ read: { status: 'missing' }, trace: () => { throw new Error('sink down'); } });
    await bad.handoff.onCoordinatorIdle(traceCtx);
    expect(bad.nudge).toHaveBeenCalledOnce();
  });

  it('host sink stamps the current attempt/stateVersion generation', async () => {
    const log = vi.fn();
    const generation = vi.fn(async () => ({ attempt: 2, stateVersion: 7 }));
    const sink = createPlanTraceSink({ generation, log });
    const event: PlanHandoffTrace = { executionId: 'ui:exec-1', projectId: 'proj-1', slotId: 'slot-1', sessionId: 'sess-1', stage: 'read', path: 'p', status: 'missing' };
    sink(event);
    await vi.waitFor(() => expect(log).toHaveBeenCalledOnce());
    expect(generation).toHaveBeenCalledWith('proj-1', 'ui:exec-1');
    expect(log.mock.calls[0][0]).toBe('squad plan trace read');
    expect(JSON.parse(log.mock.calls[0][1])).toEqual({ ...event, attempt: 2, stateVersion: 7 });
  });

  it('host sink logs unstamped when the record is gone or lookup fails, and absorbs log failures', async () => {
    const event: PlanHandoffTrace = { executionId: 'e', projectId: 'p', slotId: 's', sessionId: 'x', stage: 'nudge', path: 'p', nudges: 1 };
    const missingLog = vi.fn();
    createPlanTraceSink({ generation: async () => undefined, log: missingLog })(event);
    await vi.waitFor(() => expect(missingLog).toHaveBeenCalledOnce());
    expect(JSON.parse(missingLog.mock.calls[0][1])).toEqual(event);
    const failingLog = vi.fn();
    createPlanTraceSink({ generation: async () => { throw new Error('db'); }, log: failingLog })(event);
    await vi.waitFor(() => expect(failingLog).toHaveBeenCalledOnce());
    expect(JSON.parse(failingLog.mock.calls[0][1])).toEqual(event);
    const throwingLog = vi.fn(() => { throw new Error('log down'); });
    expect(() => createPlanTraceSink({ generation: async () => undefined, log: throwingLog })(event)).not.toThrow();
    await vi.waitFor(() => expect(throwingLog).toHaveBeenCalledOnce());
  });
});
