import { beforeEach, describe, expect, it, vi } from 'vitest';
import { link, mkdir, mkdtemp, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as sourcePolicy from '../source-policy.js';
import { ExecutionSourceError, createExecutionSourceRegistry, type ExecutionSourceBinding } from '../source-registry.js';

// Pass-through spy: lets one case force the 'links' refusal, which a real filesystem's own
// symlink limit reaches before the policy's hop limit.
vi.mock('../source-policy.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../source-policy.js')>();
  return { ...actual, sourceRefusal: vi.fn(actual.sourceRefusal) };
});

const P = 'project-1';
const A: ExecutionSourceBinding = { kind: 'session', sessionId: 'session-a' };
const B: ExecutionSourceBinding = { kind: 'session', sessionId: 'session-b' };
let keys = 0;

async function fixture(run: (dir: string, clock: { t: number }) => Promise<void>): Promise<void> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'zcc-execution-session-')));
  try { await run(dir, { t: 1_000_000 }); } finally { await rm(dir, { recursive: true, force: true }); }
}

function make(dir: string, clock: { t: number }) {
  let n = 0;
  return createExecutionSourceRegistry({ rootDir: join(dir, 'store'), now: () => clock.t, id: () => `cap-${++n}` });
}

type Registry = ReturnType<typeof make>;
type Scope = { binding: ExecutionSourceBinding } | { windowId: number };
const policyFor = (dir: string) => ({ roots: [join(dir, 'project'), join(dir, 'home')], home: join(dir, 'home') });
const issueAs = (r: Registry, scope: Scope, paths: string[], policy: sourcePolicy.SourcePolicy | undefined, projectId = P) =>
  r.issue({ ...scope, projectId, paths, policy } as Parameters<Registry['issue']>[0]);
const resolveAs = (r: Registry, scope: Scope, ids: string[], projectId = P) =>
  r.resolve({ ...scope, projectId, capabilityIds: ids, snapshotKey: `k${++keys}` } as Parameters<Registry['resolve']>[0]);
const reissueAs = (r: Registry, scope: Scope, ids: string[]) =>
  r.reissue({ ...scope, projectId: P, capabilityIds: ids } as Parameters<Registry['reissue']>[0]);
const discardAs = (r: Registry, scope: Scope, ids: string[]) =>
  r.discardRetired({ ...scope, projectId: P, capabilityIds: ids } as Parameters<Registry['discardRetired']>[0]);
const failure = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return { code: (e as ExecutionSourceError).code, message: (e as Error).message }; }
  return undefined;
};

async function plan(dir: string, name = 'plan.md', content = 'the plan'): Promise<string> {
  await mkdir(join(dir, 'project'), { recursive: true });
  await mkdir(join(dir, 'home'), { recursive: true });
  const file = join(dir, 'project', name);
  await writeFile(file, content);
  return file;
}

describe('execution source registry session binding', () => {
  beforeEach(() => { vi.mocked(sourcePolicy.sourceRefusal).mockClear(); });

  it('refuses a session issue without a source policy and creates nothing', async () => fixture(async (dir, clock) => {
    const file = await plan(dir);
    const r = make(dir, clock);
    expect(await failure(issueAs(r, { binding: A }, [file], undefined)))
      .toEqual({ code: 'INVALID_CAPABILITY', message: 'Session execution sources require a source policy' });
    // Nothing was issued: the first real issue gets the first id.
    expect((await issueAs(r, { binding: A }, [file], policyFor(dir)))[0].id).toBe('cap-1');
  }));

  it('refuses a malformed or ambiguous binding on issue and resolve', async () => fixture(async (dir, clock) => {
    const file = await plan(dir);
    const r = make(dir, clock);
    const policy = policyFor(dir);
    const [cap] = await issueAs(r, { binding: A }, [file], policy);
    const malformed: unknown[] = [
      {},
      { windowId: undefined },
      { windowId: 1.5 },
      { windowId: '7' },
      { binding: null },
      { binding: 'session-a' },
      { binding: { kind: 'session', sessionId: '' } },
      { binding: { kind: 'session', sessionId: 'x'.repeat(257) } },
      { binding: { kind: 'session', sessionId: 7 } },
      { binding: { kind: 'window', windowId: '7' } },
      { binding: { kind: 'other', sessionId: 'session-a' } },
      { windowId: 7, binding: A }
    ];
    for (const scope of malformed) {
      expect(await failure(issueAs(r, scope as Scope, [file], policy))).toMatchObject({ code: 'INVALID_CAPABILITY' });
      expect(await failure(resolveAs(r, scope as Scope, [cap.id]))).toMatchObject({ code: 'INVALID_CAPABILITY' });
    }
    // A refused presentation never consumed the capability.
    await expect(resolveAs(r, { binding: A }, [cap.id])).resolves.toBeTruthy();
  }));

  it('refuses outside, protected and hard-linked paths with the same errors as a window', async () => fixture(async (dir, clock) => {
    await plan(dir);
    const home = join(dir, 'home');
    await mkdir(join(home, '.ssh'), { recursive: true });
    await mkdir(join(home, 'dotfiles'), { recursive: true });
    await mkdir(join(dir, 'outside'));
    await writeFile(join(dir, 'outside', 'plan.md'), 'secret');
    await writeFile(join(home, '.ssh', 'id_rsa'), 'PRIVATE');
    await writeFile(join(home, 'dotfiles', 'key'), 'PRIVATE');
    await symlink(join(home, 'dotfiles', 'key'), join(home, '.ssh', 'chain'));
    await symlink(join(home, '.ssh', 'chain'), join(home, 'notes.md'));
    await writeFile(join(home, 'secret.txt'), 'PRIVATE');
    await link(join(home, 'secret.txt'), join(home, 'hard.md'));
    const policy = { ...policyFor(dir), protectedRoots: [join(home, '.ssh')] };
    const r = make(dir, clock);
    const cases: Array<[string, { code: string; message: string }]> = [
      [join(dir, 'outside', 'plan.md'), { code: 'UNSUPPORTED_SOURCE', message: 'plan.md is outside the project and your home folder' }],
      [join(home, '.ssh', 'id_rsa'), { code: 'UNSUPPORTED_SOURCE', message: 'id_rsa is in a protected location' }],
      // Link chain through ~/.ssh to an allowed realpath.
      [join(home, 'notes.md'), { code: 'UNSUPPORTED_SOURCE', message: 'key is in a protected location' }],
      [join(home, 'hard.md'), { code: 'UNSUPPORTED_SOURCE', message: 'hard.md is a hard-linked file' }]
    ];
    for (const [path, expected] of cases) {
      expect(await failure(issueAs(r, { binding: A }, [path], policy))).toEqual(expected);
      expect(await failure(issueAs(r, { windowId: 7 }, [path], policy))).toEqual(expected);
    }
  }));

  it('refuses a path reached through too many links for a session as for a window', async () => fixture(async (dir, clock) => {
    const file = await plan(dir);
    const r = make(dir, clock);
    const expected = { code: 'UNSUPPORTED_SOURCE', message: 'plan.md is reached through too many links' };
    vi.mocked(sourcePolicy.sourceRefusal).mockResolvedValueOnce('links').mockResolvedValueOnce('links');
    expect(await failure(issueAs(r, { binding: A }, [file], policyFor(dir)))).toEqual(expected);
    expect(await failure(issueAs(r, { windowId: 7 }, [file], policyFor(dir)))).toEqual(expected);
  }));

  it('confines every session issue with the policy it was given', async () => fixture(async (dir, clock) => {
    const file = await plan(dir);
    const policy = policyFor(dir);
    await issueAs(make(dir, clock), { binding: A }, [file], policy);
    expect(sourcePolicy.sourceRefusal).toHaveBeenCalledWith(file, file, policy);
  }));

  it('resolves a session capability once, for its own session and project only', async () => fixture(async (dir, clock) => {
    const file = await plan(dir);
    const r = make(dir, clock);
    const [cap] = await issueAs(r, { binding: A }, [file], policyFor(dir));
    const foreign: Array<[Scope, string?]> = [
      [{ binding: B }],
      [{ windowId: 7 }],
      [{ binding: { kind: 'window', windowId: 7 } }],
      [{ binding: A }, 'project-2']
    ];
    for (const [scope, projectId] of foreign) {
      expect(await failure(resolveAs(r, scope, [cap.id], projectId)))
        .toEqual({ code: 'FOREIGN_CAPABILITY', message: 'Execution source capability belongs to another window, session, or project' });
    }
    // A foreign attempt neither consumes nor invalidates the capability for its owner.
    const resolved = await resolveAs(r, { binding: A }, [cap.id]);
    expect(resolved.sources.map(({ extractedText }) => extractedText)).toEqual(['the plan']);
    expect(await failure(resolveAs(r, { binding: A }, [cap.id]))).toMatchObject({ code: 'REPLAYED_CAPABILITY' });
  }));

  it('never lets a session resolve a window capability, even with a matching id string', async () => fixture(async (dir, clock) => {
    const file = await plan(dir);
    const r = make(dir, clock);
    const [cap] = await issueAs(r, { windowId: 7 }, [file], undefined);
    for (const scope of [{ binding: { kind: 'session', sessionId: '7' } }, { binding: A }] as Scope[]) {
      expect(await failure(resolveAs(r, scope, [cap.id]))).toMatchObject({ code: 'FOREIGN_CAPABILITY' });
    }
    // The explicit window binding and the original `{ windowId }` form are the same binding.
    await expect(resolveAs(r, { binding: { kind: 'window', windowId: 7 } }, [cap.id])).resolves.toBeTruthy();
  }));

  it('reuses an outstanding capability only for the same binding and project', async () => fixture(async (dir, clock) => {
    const file = await plan(dir);
    const r = make(dir, clock);
    const policy = policyFor(dir);
    const [first] = await issueAs(r, { binding: A }, [file], policy);
    expect((await issueAs(r, { binding: A }, [file], policy))[0].id).toBe(first.id);
    const others = [
      await issueAs(r, { binding: B }, [file], policy),
      await issueAs(r, { windowId: 7 }, [file], policy),
      await issueAs(r, { binding: A }, [file], policy, 'project-2')
    ].map(([view]) => view.id);
    expect(new Set([first.id, ...others]).size).toBe(4);
  }));

  it('renews a retired session capability only for its own session', async () => fixture(async (dir, clock) => {
    const file = await plan(dir);
    const r = make(dir, clock);
    const [cap] = await issueAs(r, { binding: A }, [file], policyFor(dir));
    await resolveAs(r, { binding: A }, [cap.id]);
    for (const scope of [{ binding: B }, { windowId: 7 }, { binding: { kind: 'session', sessionId: '' } }] as Scope[]) {
      expect(await reissueAs(r, scope, [cap.id])).toEqual({ renewed: [], dropped: [{ previousId: cap.id, reason: 'unknown' }] });
    }
    const out = await reissueAs(r, { binding: A }, [cap.id]);
    expect(out.dropped).toEqual([]);
    const renewed = out.renewed[0].source.id;
    // The renewal keeps the session binding.
    expect(await failure(resolveAs(r, { windowId: 7 }, [renewed]))).toMatchObject({ code: 'FOREIGN_CAPABILITY' });
    await expect(resolveAs(r, { binding: A }, [renewed])).resolves.toBeTruthy();
  }));

  it('does not report a live session capability to another binding', async () => fixture(async (dir, clock) => {
    const file = await plan(dir);
    const r = make(dir, clock);
    const [cap] = await issueAs(r, { binding: A }, [file], policyFor(dir));
    expect(await reissueAs(r, { binding: B }, [cap.id])).toEqual({ renewed: [], dropped: [{ previousId: cap.id, reason: 'unknown' }] });
    expect((await reissueAs(r, { binding: A }, [cap.id])).renewed).toEqual([
      { previousId: cap.id, source: expect.objectContaining({ id: cap.id }), changed: false }
    ]);
  }));

  it('keeps refusing a hard link when renewing a session capability', async () => fixture(async (dir, clock) => {
    const file = await plan(dir);
    const r = make(dir, clock);
    const [cap] = await issueAs(r, { binding: A }, [file], policyFor(dir));
    await resolveAs(r, { binding: A }, [cap.id]);
    await writeFile(join(dir, 'home', 'secret'), 'PRIVATE');
    await unlink(file);
    await link(join(dir, 'home', 'secret'), file);
    expect(await reissueAs(r, { binding: A }, [cap.id])).toEqual({ renewed: [], dropped: [{ previousId: cap.id, name: 'plan.md', reason: 'unreadable' }] });
  }));

  it('discards retired records only for the binding that consumed them', async () => fixture(async (dir, clock) => {
    const file = await plan(dir);
    const r = make(dir, clock);
    const [cap] = await issueAs(r, { binding: A }, [file], policyFor(dir));
    await resolveAs(r, { binding: A }, [cap.id]);
    for (const scope of [{ binding: B }, { windowId: 7 }, { windowId: undefined }] as Scope[]) discardAs(r, scope, [cap.id]);
    expect((await reissueAs(r, { binding: A }, [cap.id])).renewed).toHaveLength(1);
    const [again] = await issueAs(r, { binding: A }, [file], policyFor(dir));
    await resolveAs(r, { binding: A }, [again.id]);
    discardAs(r, { binding: A }, [again.id]);
    expect(await reissueAs(r, { binding: A }, [again.id])).toEqual({ renewed: [], dropped: [{ previousId: again.id, reason: 'unknown' }] });
  }));
});
