import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, lstat, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionWorkUnitInput } from '@zana-ai/zcc-server/services/execution/store';
import {
  MAX_HANDOFF_FILE_BYTES,
  TeamPlanHandoff,
  authoredPlanRelPath,
  cleanupHandoffFiles,
  readAuthoredPlan,
  sourceMirrorRelPath,
  writeSourceMirror,
  type AuthoredPlanRead,
  type CoordinatorHandoffContext
} from '../team-plan-handoff.js';

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

  it('nudges when the host rejects the register, without latching done', async () => {
    const { handoff, nudge, register } = deps({ register: async () => ({ ok: false, message: 'budget exceeded' }) });
    await handoff.onCoordinatorIdle(ctx);
    expect(register).toHaveBeenCalledOnce();
    expect(nudge.mock.calls[0][1]).toContain('budget exceeded');
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
