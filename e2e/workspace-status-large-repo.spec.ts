import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures/app.js';

// A large checkout is simulated with a `git` wrapper on PATH: every
// `git status -uall` (the untracked-file walk) sleeps past the host's 2s
// inline budget and is logged; everything else runs real git unchanged.
// This exercises the full renderer → server → host-daemon → git chain.
const SCAN_DELAY_S = 4;
const realGit = execFileSync('/usr/bin/env', ['which', 'git'], { encoding: 'utf8' }).trim();
const scanLog = (home: string) => join(home, 'git-scans.log');

test.use({
  isolateBundledCatalog: true,
  initialConfig: { sponsorPromptDismissed: true },
  launchEnv: async ({ home }, use) => {
    const bin = join(home, 'slow-git-bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'git'), `#!/bin/sh
for arg in "$@"; do
  if [ "$arg" = "-uall" ]; then
    echo "scan $PWD" >> '${scanLog(home)}'
    sleep ${SCAN_DELAY_S}
    break
  fi
done
exec '${realGit}' "$@"
`);
    chmodSync(join(bin, 'git'), 0o755);
    // The app rebuilds PATH from an interactive login shell, whose rc files
    // would put the real git first; prepend the wrapper there too.
    const shellInit = `export PATH='${bin}':"$PATH"\n`;
    for (const name of ['.zshrc', '.bashrc', '.bash_profile']) writeFileSync(join(home, name), shellInit);
    await use({ ZCC_FAKE_PROVIDER: '1', PATH: `${bin}:${process.env.PATH ?? ''}` });
  }
});

test('a slow untracked scan never blocks status and runs once in the background', async ({ app }) => {
  const { window, home } = app;
  const projectPath = join(home, 'large-repo-project');
  mkdirSync(projectPath);
  const git = (...args: string[]) => execFileSync(realGit, args, { cwd: projectPath });
  git('init', '--quiet');
  writeFileSync(join(projectPath, 'README.md'), 'Large repo fixture\n');
  git('add', 'README.md');
  git('-c', 'user.name=E2E', '-c', 'user.email=e2e@example.test', 'commit', '--quiet', '-m', 'Initial');
  writeFileSync(join(projectPath, 'README.md'), 'Large repo fixture changed\n');
  writeFileSync(join(projectPath, 'scratch-notes.txt'), 'untracked\n');
  const scans = () => existsSync(scanLog(home))
    ? readFileSync(scanLog(home), 'utf8').split('\n').filter((line) => line.includes('large-repo-project')).length
    : 0;

  const statusRequests: number[] = [];
  window.on('request', (request) => {
    if (/\/api\/v1\/environments\/[^/]+\/status$/.test(new URL(request.url()).pathname)) statusRequests.push(Date.now());
  });

  const threadId = await window.evaluate(async (path) => {
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error('Project registration failed');
    const response = await fetch('/api/v1/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.value.id, providerId: 'fake', input: 'Check status' })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(body));
    return (body.thread ?? body.value).id as string;
  }, projectPath);
  const openedAt = Date.now();
  await window.evaluate((id) => {
    window.history.pushState({}, '', `/threads/${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, threadId);

  // Tracked changes arrive without waiting for the slow walk.
  const banner = window.getByTestId('thread-workspace-banner');
  await expect(banner).toBeVisible({ timeout: SCAN_DELAY_S * 1_000 - 500 });
  await banner.getByRole('button', { name: /^\d+\+? Files?$/ }).click();
  await expect(banner.getByText('README.md')).toBeVisible();
  await expect(window.getByTestId('thread-workspace-untracked-note')).toHaveText(/large repository/);
  expect(scans()).toBeGreaterThan(0);

  // Once the background scan lands, the untracked file appears and the note clears.
  await expect(banner.getByText('scratch-notes.txt')).toBeVisible({ timeout: 15_000 });
  await expect(window.getByTestId('thread-workspace-untracked-note')).toHaveCount(0);

  // Keep the thread open across several poll ticks.
  await window.waitForTimeout(7_000);
  // Several surfaces poll every 3-4s; shared requests keep it to about one a second.
  const elapsedS = (Date.now() - openedAt) / 1_000;
  expect(statusRequests.length).toBeGreaterThan(0);
  expect(statusRequests.length).toBeLessThanOrEqual(Math.ceil(elapsedS) + 2);
  // A slow checkout rescans at most once a minute, however many pollers ask.
  expect(scans()).toBe(1);
});
