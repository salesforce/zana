import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createWorktree, isGitRepo } from '@zana-ai/zcc-server/services/projects/git';
import { createInboxStore } from '@zana-ai/zcc-server/services/inbox/inbox-store';
import {
  ineligibleSquadWorktreeFallback,
  resolveSquadWorktreeIsolation,
  resolveSquadWorktreePreparation,
  SQUAD_WORKTREE_FALLBACK_NOTICE
} from './squad-worktree-lifecycle.js';

type Tri = boolean | undefined;
const TRI: Tri[] = [undefined, true, false];
const name = (value: Tri) => (value === undefined ? 'inherit' : value ? 'on' : 'off');

/** Independent oracle: first defined setting wins, most specific first. */
function oracle(layers: Tri[]): boolean {
  for (const layer of layers) if (layer !== undefined) return layer;
  return false;
}

describe('squad worktree decision: launch > Squad > Project > Global', () => {
  const combos = TRI.flatMap((launch) => TRI.flatMap((squad) => TRI.flatMap((project) => TRI.map((global) => ({ launch, squad, project, global })))));

  it('covers every combination of the four layers', () => {
    expect(combos).toHaveLength(81);
  });

  it.each(combos.map((c) => [`launch=${name(c.launch)} squad=${name(c.squad)} project=${name(c.project)} global=${name(c.global)}`, c] as const))(
    'isolation: %s',
    (_label, c) => {
      expect(resolveSquadWorktreeIsolation(c)).toBe(oracle([c.launch, c.squad, c.project, c.global]));
    }
  );

  it.each(combos.map((c) => [`launch=${name(c.launch)} squad=${name(c.squad)} project=${name(c.project)} global=${name(c.global)}`, c] as const))(
    'fresh launch applies the decision: %s',
    (_label, c) => {
      const expected = oracle([c.launch, c.squad, c.project, c.global]) ? 'create' : 'project-root';
      expect(resolveSquadWorktreePreparation({ retained: false, ...c })).toBe(expected);
    }
  );

  it.each(combos.map((c) => [`launch=${name(c.launch)} squad=${name(c.squad)} project=${name(c.project)} global=${name(c.global)}`, c] as const))(
    'a retained checkout is always reattached, never re-decided: %s',
    (_label, c) => {
      expect(resolveSquadWorktreePreparation({ retained: true, ...c })).toBe('reattach');
    }
  );

  it.each([
    ['MT-1 step 3: everything inherit, global on', { global: true }, true],
    ['MT-1 step 4: Squad Off over global on', { global: true, squad: false }, false],
    ['MT-1 step 5: Project never over global on (Squad inherit)', { global: true, project: false }, false],
    ['MT-1 step 6: Project always over global off (Squad inherit)', { global: false, project: true }, true],
    ['MT-1 step 7: all inherit, global off', { global: false }, false]
  ] as const)('manual scenario %s', (_label, layers, expected) => {
    expect(resolveSquadWorktreeIsolation(layers)).toBe(expected);
    expect(resolveSquadWorktreePreparation({ retained: false, ...layers })).toBe(expected ? 'create' : 'project-root');
  });
});

describe('ineligible project falls back to the project root with one Inbox notice', () => {
  let root: string;
  let gitProject: string;
  let plainProject: string;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, stdio: 'pipe', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'squad-worktree-resolution-')));
    gitProject = join(root, 'git-project');
    plainProject = join(root, 'plain-project');
    mkdirSync(gitProject);
    mkdirSync(plainProject);
    writeFileSync(join(plainProject, 'a.txt'), 'x');
    git(gitProject, 'init', '-q', '-b', 'main');
    git(gitProject, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init');
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  /**
   * Mirrors the decision sequence the host runs for a fresh launch: resolve the
   * preparation, short-circuit to the project root, else check eligibility
   * (notice + root fallback) and only then create the shared worktree.
   */
  async function prepare(
    project: { id: string; path: string; remote?: unknown; quickAgent?: boolean },
    layers: { launch?: boolean; squad?: boolean; project?: boolean; global?: boolean },
    executionId: string,
    inbox: ReturnType<typeof createInboxStore>
  ): Promise<{ worktreePath?: string }> {
    if (resolveSquadWorktreePreparation({ retained: false, ...layers }) === 'project-root') return {};
    const fallback = await ineligibleSquadWorktreeFallback(project, isGitRepo);
    if (fallback) {
      await inbox.appendOnce({
        projectId: project.id,
        projectLabel: project.id,
        subject: fallback.notice.subject,
        comments: fallback.notice.comments,
        executionId,
        dedupeKey: `squad-worktree-fallback:${executionId}`
      });
      return {};
    }
    const target = join(project.path, '.worktrees', `squad-${executionId}`);
    const created = await createWorktree(project.path, target, `zcc/squad-${executionId}`, join(project.path, '.worktrees'), true);
    if (!created.ok) throw new Error(created.reason);
    return { worktreePath: created.path };
  }

  const newInbox = (dir: string) => createInboxStore({ filePath: join(dir, 'inbox.jsonl') });

  it('real isGitRepo distinguishes a git checkout from a plain folder', async () => {
    expect(await isGitRepo(gitProject)).toBe(true);
    expect(await isGitRepo(plainProject)).toBe(false);
    expect(await isGitRepo(join(root, 'does-not-exist'))).toBe(false);
  });

  it.each([
    ['non-git local project', () => ({ id: 'plain', path: plainProject })],
    ['remote project', () => ({ id: 'remote', path: gitProject, remote: { host: 'h' } })],
    ['quick-agent project', () => ({ id: 'quick', path: gitProject, quickAgent: true })]
  ])('%s: no worktree, exactly one Inbox notice with exact copy, even when the launch is retried', async (_kind, makeProject) => {
    const dir = mkdtempSync(join(root, 'inbox-'));
    const inbox = newInbox(dir);
    const project = makeProject();

    // Global default on (MT-2 step 2) and again via Squad On; the same execution is retried.
    const first = await prepare(project, { global: true }, 'exec-1', inbox);
    const retry = await prepare(project, { squad: true }, 'exec-1', inbox);

    expect(first).toEqual({});
    expect(retry).toEqual({});
    expect(existsSync(join(project.path, '.worktrees'))).toBe(false);
    const { entries } = await inbox.read({ projectId: project.id });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      subject: 'Squad ran in the project folder',
      comments: 'Worktrees need a local Git project, so this squad worked in the project folder. Its changes are in your working copy.',
      executionId: 'exec-1'
    });
    expect({ subject: entries[0]!.subject, comments: entries[0]!.comments }).toEqual(SQUAD_WORKTREE_FALLBACK_NOTICE);
  });

  it('a different execution in the same ineligible project gets its own single notice', async () => {
    const inbox = newInbox(mkdtempSync(join(root, 'inbox-')));
    const project = { id: 'plain', path: plainProject };
    await prepare(project, { global: true }, 'exec-a', inbox);
    await prepare(project, { global: true }, 'exec-b', inbox);
    expect((await inbox.read({ projectId: 'plain' })).entries.map((e) => e.executionId).sort()).toEqual(['exec-a', 'exec-b']);
  });

  it('isolation resolving to off never produces a notice, even for an ineligible project', async () => {
    const inbox = newInbox(mkdtempSync(join(root, 'inbox-')));
    const result = await prepare({ id: 'plain', path: plainProject }, { global: true, squad: false }, 'exec-off', inbox);
    expect(result).toEqual({});
    expect((await inbox.read({})).entries).toHaveLength(0);
  });

  it('an eligible local git project gets a real shared worktree under .worktrees and no notice', async () => {
    const inbox = newInbox(mkdtempSync(join(root, 'inbox-')));
    const result = await prepare({ id: 'git', path: gitProject }, { global: true }, 'exec-git', inbox);

    expect(result.worktreePath).toBeDefined();
    expect(realpathSync(result.worktreePath!)).toBe(join(gitProject, '.worktrees', 'squad-exec-git'));
    expect(existsSync(join(result.worktreePath!, '.git'))).toBe(true);
    expect(git(gitProject, 'branch', '--list', 'zcc/squad-exec-git').toString()).toContain('zcc/squad-exec-git');
    expect((await inbox.read({})).entries).toHaveLength(0);
  });
});
