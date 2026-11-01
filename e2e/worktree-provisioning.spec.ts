import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

test.use({
  launchEnv: { ZCC_FAKE_PROVIDER: '1', PATH: process.env.PATH ?? '' },
  isolateBundledCatalog: true,
  initialConfig: { sponsorPromptDismissed: true }
});

test('a worktree with a large include listing and setup over 30 seconds reaches a usable thread', async ({ app }) => {
  test.setTimeout(120_000);
  const { window, home } = app;
  const projectPath = join(home, 'provisioning-regression');
  mkdirSync(projectPath);
  function git(args: string[]) { return execFileSync('git', args, { cwd: projectPath, encoding: 'utf8', timeout: 15_000 }); }
  git(['init', '--quiet', '-b', 'main']);
  writeFileSync(join(projectPath, 'README.md'), 'Worktree provisioning fixture\n');
  writeFileSync(join(projectPath, '.gitignore'), '.env\nlocal-config/\n.git-worktrees/\n');
  writeFileSync(join(projectPath, '.worktreeinclude'), '.env\nlocal-config/\n');
  // Exercise a real setup process beyond the old host RPC deadline.
  writeFileSync(join(projectPath, '.zcc-env-setup.sh'), 'set -eu\nsleep 32\ncat .env > setup-read-env\n');
  git(['add', '.']);
  git(['-c', 'user.name=Provision E2E', '-c', 'user.email=provision@example.test', 'commit', '--quiet', '-m', 'Initial fixture']);
  writeFileSync(join(projectPath, '.env'), 'fixture-only\n');
  mkdirSync(join(projectPath, 'local-config'));
  const names = Array.from({ length: 220 }, (_, index) => `config-${String(index).padStart(4, '0')}-${'x'.repeat(45)}.txt`);
  for (const name of names) writeFileSync(join(projectPath, 'local-config', name), name);
  // Prove the host/Electron Git integration receives output beyond 8192 bytes.
  expect(Buffer.byteLength(names.map(name => `local-config/${name}`).join('\0'))).toBeGreaterThan(8192);
  const nested = join(projectPath, '.git-worktrees', 'other');
  mkdirSync(nested, { recursive: true });
  execFileSync('git', ['init', '--quiet', '-b', 'main'], { cwd: nested });
  writeFileSync(join(nested, '.env'), 'other-checkout\n');

  const thread = await window.evaluate(async path => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Worktree is ready', environment: { kind: 'worktree' } })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return body.thread as { id: string; environmentId: string; hostId: string; cwd: string; isWorktree: boolean };
  }, projectPath);
  expect(thread.isWorktree).toBe(true);
  expect(thread.cwd).not.toBe(projectPath);
  expect(readFileSync(join(thread.cwd, 'setup-read-env'), 'utf8')).toBe('fixture-only\n');
  expect(readdirSync(join(thread.cwd, 'local-config')).sort()).toEqual(names);
  expect(readFileSync(join(thread.cwd, 'local-config', names.at(-1)!), 'utf8')).toBe(names.at(-1));
  expect(existsSync(join(thread.cwd, '.git-worktrees'))).toBe(false);
  expect(git(['branch', '--show-current']).trim()).toBe('main');

  await window.evaluate(id => {
    history.pushState({}, '', `/threads/${id}`);
    dispatchEvent(new PopStateEvent('popstate'));
  }, thread.id);
  const detail = window.getByTestId('thread-detail');
  await expect(detail.getByTestId('thread-command-input')).toBeVisible();
  await expect(detail.getByTestId('thread-prompt-context')).toContainText('git: zcc/');
  await expect(detail.getByTestId('thread-timeline')).toContainText('Response to: Worktree is ready');
  await detail.getByTestId('thread-command-input').fill('Follow up in this worktree');
  await detail.getByTestId('thread-command-send').click();
  await expect(detail.getByTestId('thread-timeline')).toContainText('Response to: Follow up in this worktree');
  await expect(detail.getByText('environment does not belong to this project and machine', { exact: true })).toHaveCount(0);
});
