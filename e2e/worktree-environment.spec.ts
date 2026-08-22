/**
 * Workspace picker + managed worktree lifecycle on the built Electron app.
 * New worktrees land under ~/.zcc/worktrees/<environmentId>/<repoName>.
 */
import { test, expect, type Page } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const fakeGhDir = mkdtempSync(join(tmpdir(), 'zcc-e2e-gh-'));
writeFileSync(join(fakeGhDir, 'gh'), `#!/bin/sh
LOG="${join(fakeGhDir, 'invocations')}"
printf '%s\\n' "$*" >> "$LOG"
if [ "$1" = pr ] && [ "$2" = create ]; then
  touch "${join(fakeGhDir, 'created')}"
  echo https://example.test/pr/42
  exit 0
fi
if [ "$1" = pr ] && [ "$2" = view ]; then
  [ -f "${join(fakeGhDir, 'created')}" ] || exit 1
  echo '{"number":42,"title":"e2e","state":"OPEN","url":"https://example.test/pr/42","isDraft":false,"baseRefName":"main","headRefName":"zcc/e2e","updatedAt":null,"reviewDecision":null,"mergeStateStatus":null,"mergeable":"MERGEABLE"}'
  exit 0
fi
exit 0
`);
chmodSync(join(fakeGhDir, 'gh'), 0o755);

const fakeClaude = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' });
copyFileSync(fakeClaude.path, join(fakeGhDir, 'claude'));
chmodSync(join(fakeGhDir, 'claude'), 0o755);

test.use({
  e2e: true,
  launchEnv: {
    PATH: `${fakeGhDir}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    ZCC_GH_BINARY: join(fakeGhDir, 'gh')
  },
  initialConfig: { claudeBinary: join(fakeGhDir, 'claude'), defaultHarness: 'claude' }
});

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
}

function managedWorktreeRoots(home: string): string[] {
  return [
    join(home, '.zcc', 'worktrees'),
    process.env.ZCC_DATA_DIR ? join(process.env.ZCC_DATA_DIR, 'worktrees') : '',
    join(homedir(), '.zcc', 'worktrees')
  ].filter(Boolean);
}

function listManagedWorktreePaths(home: string): string[] {
  const out: string[] = [];
  for (const root of managedWorktreeRoots(home)) {
    if (!existsSync(root)) continue;
    for (const envId of readdirSync(root)) {
      const envDir = join(root, envId);
      let names: string[] = [];
      try {
        names = readdirSync(envDir);
      } catch {
        continue;
      }
      for (const name of names) out.push(join(envDir, name));
    }
  }
  return [...new Set(out)];
}

function initGitProject(prefix: string, parentDir = tmpdir()): { dir: string; name: string } {
  const dir = mkdtempSync(join(parentDir, prefix));
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'E2E']);
  git(dir, ['config', 'user.email', 'e2e@example.com']);
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-m', 'init']);
  return { dir, name: basename(dir) };
}

async function ensureSidebarExpanded(window: Page): Promise<void> {
  const expand = window.getByRole('button', { name: 'Expand sidebar' });
  if (await expand.isVisible().catch(() => false)) {
    await expand.click();
  }
  await expect(window.getByRole('link', { name: 'Settings' })).toBeVisible({ timeout: 15_000 });
}

async function addProjectAndWait(window: Page, projectDir: string): Promise<string> {
  const expectedName = basename(projectDir);
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const added = await window.evaluate(async (path) => {
      return await window.cc.projects.add(path) as { ok?: boolean; message?: string; value?: { name?: string }; name?: string };
    }, projectDir);
    if (added && added.ok === false) {
      lastError = added.message ?? JSON.stringify(added);
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    const registeredName = added?.value?.name ?? added?.name ?? expectedName;
    const names = await window.evaluate(async () => {
      const list = await window.cc.projects.list() as Array<{ name?: string }>;
      return list.map((row) => row.name ?? '');
    });
    if (names.includes(registeredName)) return registeredName;
    try {
      await expect.poll(async () => {
        const listed = await window.evaluate(async () => {
          const list = await window.cc.projects.list() as Array<{ name?: string }>;
          return list.map((row) => row.name ?? '');
        });
        return listed;
      }, { timeout: 8_000 }).toContain(registeredName);
      return registeredName;
    } catch (error) {
      lastError = `${error instanceof Error ? error.message : String(error)}; add=${JSON.stringify(added)}`;
    }
  }
  throw new Error(`projects.add did not register ${expectedName}: ${lastError}`);
}

async function openLaunchedAgent(window: Page, title: string): Promise<void> {
  const modal = window.locator('[data-testid="agent-terminal-modal"]');
  try {
    await expect(window.locator('[data-testid="launch-modal"]')).toBeHidden({ timeout: 30_000 });
  } catch {
    /* inspector may cover the launcher */
  }
  if (await modal.isVisible().catch(() => false)) return;
  await window.getByRole('button', { name: new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }).first().click();
  await expect(modal).toBeVisible({ timeout: 15_000 });
}

function writeSandboxClaudeBinary(home: string, bin: string): void {
  const dir = join(home, '.zcc');
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, 'config.json');
  const current = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>
    : {};
  writeFileSync(configPath, JSON.stringify({
    ...current,
    claudeBinary: bin,
    defaultHarness: 'claude'
  }, null, 2));
}

async function prepareClaudeAndProject(
  window: Page,
  home: string,
  agentPath: string,
  projectDir: string
): Promise<void> {
  writeSandboxClaudeBinary(home, agentPath);
  await window.evaluate((bin) => window.cc.config.set({
    claudeBinary: bin,
    defaultHarness: 'claude'
  }), agentPath);
  await ensureSidebarExpanded(window);
  await window.getByRole('link', { name: 'Settings' }).click();
  await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
  const claudeSettings = window.locator('#settings-anchor-harness-claude');
  await expect(claudeSettings.locator('.opener-row-status')).toHaveClass(/opener-row-status--ok/);
  await window.locator('.settings-app-back').click();
  await expect(window.getByRole('link', { name: 'Settings' })).toBeVisible({ timeout: 15_000 });
  await addProjectAndWait(window, projectDir);
}

async function openWorktreeLauncher(window: Page, projectName: string, prompt: string): Promise<void> {
  await ensureSidebarExpanded(window);
  await window.locator('.sidebar-agents-actions').getByRole('button', { name: 'New quick agent' }).click();
  const modal = window.locator('[data-testid="launch-modal"]');
  await expect(modal).toBeVisible();
  await modal.locator('[data-testid="launch-instruction"]').fill(prompt);
  const targetProject = modal.getByRole('button', { name: 'Target project' });
  await targetProject.click();
  const projectList = window.getByRole('listbox', { name: 'Target project' });
  const projectSearch = projectList.locator('input');
  if (await projectSearch.count()) {
    await projectSearch.fill(projectName);
  }
  await projectList.getByRole('option', { name: projectName, exact: true }).click();
  await expect(targetProject).toContainText(projectName);
  const harnessPicker = modal.getByLabel('Launch harness');
  const claudeHarness = harnessPicker.locator('[data-testid="launch-profile-claude"]');
  if (await claudeHarness.count()) {
    await claudeHarness.click();
  }
  await modal.locator('.launch-advanced-toggle').click();
  await expect(modal.getByLabel('Workspace')).toBeVisible({ timeout: 15_000 });
  await modal.getByLabel('Workspace').click();
  await window.getByRole('option', { name: 'New worktree' }).click();
  await expect(modal.locator('[data-testid="launch-send"]')).toBeEnabled({ timeout: 15_000 });
}

async function listProductThreads(window: Page): Promise<Array<{ id: string; cwd?: string | null; environmentId?: string | null }>> {
  return window.evaluate(async () => {
    const response = await fetch('/api/v1/threads', { headers: { 'x-zcc-app-surface': 'web' } });
    const body = await response.json() as { threads?: Array<{ id: string; cwd?: string | null; environmentId?: string | null }> };
    return body.threads ?? [];
  });
}

async function threadOutput(window: Page, threadId: string): Promise<string> {
  return window.evaluate(async (id) => {
    const response = await fetch(`/api/v1/threads/${id}/output`, { headers: { 'x-zcc-app-surface': 'web' } });
    const body = await response.json() as { output?: string };
    return body.output ?? '';
  }, threadId);
}

async function typeIntoHostPty(window: Page, threadId: string, text: string, term = window.locator('.term .xterm').first()): Promise<void> {
  await term.click();
  await window.keyboard.type(text);
  await window.evaluate(async ({ id, data }) => {
    await fetch(`/api/v1/threads/${id}/input`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zcc-app-surface': 'web' },
      body: JSON.stringify({ data })
    });
  }, { id: threadId, data: text });
}

async function archiveThread(window: Page, threadId: string): Promise<void> {
  await window.evaluate(async (id) => {
    await fetch(`/api/v1/threads/${id}/archive`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-zcc-app-surface': 'web' },
      body: '{}'
    });
  }, threadId);
}

test('launcher offers a workspace picker instead of an isolation checkbox', async ({ app }) => {
  const { window, home } = app;
  const agent = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' });
  const { dir: projectDir, name: projectName } = initGitProject('zcc-wt-e2e-', home);

  try {
    await prepareClaudeAndProject(window, home, agent.path, projectDir);
    await openWorktreeLauncher(window, projectName, 'inspect the checkout');
    const modal = window.locator('[data-testid="launch-modal"]');
    await expect(modal.getByText('Isolate in a git worktree')).toHaveCount(0);
    await expect(modal.getByText('Used for branch and checkout directory.')).toBeVisible();
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    agent.cleanup();
  }
});

test('New worktree lands under ~/.zcc/worktrees and typing reaches the host PTY', async ({ app }) => {
  const { window, home } = app;
  const agent = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' });
  const { dir: projectDir, name: projectName } = initGitProject('zcc-wt-life-', home);
  mkdirSync(join(projectDir, 'src'));
  writeFileSync(join(projectDir, 'src', '.gitkeep'), '');
  git(projectDir, ['add', 'src']);
  git(projectDir, ['commit', '-m', 'src']);
  const before = new Set(listManagedWorktreePaths(home));
  const readmeBefore = readFileSync(join(projectDir, 'README.md'), 'utf8');

  try {
    await prepareClaudeAndProject(window, home, agent.path, projectDir);
    await openWorktreeLauncher(window, projectName, 'inspect the checkout');
    await window.locator('[data-testid="launch-send"]').click();
    await openLaunchedAgent(window, 'inspect the checkout');

    await expect.poll(() => listManagedWorktreePaths(home).filter((path) => !before.has(path)).length, {
      timeout: 30_000
    }).toBeGreaterThan(0);
    const created = listManagedWorktreePaths(home).filter((path) => !before.has(path));
    const worktreePath = created[0]!;
    expect(worktreePath.includes(`${join('.zcc', 'worktrees')}${worktreePath.includes('/') ? '/' : ''}`) || worktreePath.includes('/.zcc/worktrees/')).toBe(true);
    expect(existsSync(join(worktreePath, 'README.md'))).toBe(true);
    expect(readFileSync(join(projectDir, 'README.md'), 'utf8')).toBe(readmeBefore);

    await expect.poll(async () => (await listProductThreads(window)).length, { timeout: 20_000 }).toBeGreaterThan(0);
    const thread = (await listProductThreads(window))[0]!;

    await typeIntoHostPty(window, thread.id, 'ZCC_WT_COMPOSER_MARKER');
    await expect.poll(async () => {
      const fromApi = await threadOutput(window, thread.id);
      const fromDom = await window.locator('.xterm').first().innerText().catch(() => '');
      return `${fromApi}\n${fromDom}`;
    }, { timeout: 20_000 }).toContain('ZCC_WT_COMPOSER_MARKER');

    writeFileSync(join(worktreePath, 'from-e2e.txt'), 'change\n');
    const actions = window.locator('[data-testid="environment-actions"]');
    await expect(actions).toBeVisible({ timeout: 15_000 });
    await expect(actions.locator('[data-testid="environment-commit"]')).toBeEnabled({ timeout: 15_000 });
    await actions.locator('[data-testid="environment-commit"]').click();
    await expect.poll(() => {
      const log = spawnSync('git', ['log', '-1', '--pretty=%s'], { cwd: worktreePath, encoding: 'utf8' });
      return log.stdout;
    }, { timeout: 20_000 }).toMatch(/ZCC commit|commit/i);
    if (await actions.locator('[data-testid="environment-squash"]').count()) {
      await actions.locator('[data-testid="environment-squash"]').click();
      await expect.poll(() => {
        const log = spawnSync('git', ['log', 'main', '-1', '--pretty=%s'], { cwd: projectDir, encoding: 'utf8' });
        return log.stdout;
      }, { timeout: 20_000 }).not.toBe('init\n');
    }
    await actions.locator('[data-testid="environment-create-pr"]').click();
    await expect.poll(() => existsSync(join(fakeGhDir, 'created')), { timeout: 20_000 }).toBe(true);

    await window.locator('[data-testid="agent-terminal-modal"]').getByLabel('Close').click();
    await expect(window.locator('[data-testid="agent-terminal-modal"]')).toBeHidden();
    await ensureSidebarExpanded(window);
    await window.getByRole('button', { name: `Open ${projectName}` }).click();
    await window.getByTestId('project-nav-explorer').click();
    const srcRow = window.locator('.tree-row.dir', { has: window.locator('.tree-name', { hasText: 'src' }) });
    await expect(srcRow).toBeVisible({ timeout: 15_000 });
    await srcRow.click({ button: 'right' });
    await window.getByText('Open shell here').click();
    await expect(window.getByRole('tab', { name: /Shell/ })).toBeVisible({ timeout: 20_000 });
    const shellTerm = window.locator('.term .xterm').last();
    await expect(shellTerm).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await listProductThreads(window)).length, { timeout: 20_000 }).toBeGreaterThan(1);
    const shellThread = (await listProductThreads(window)).at(-1)!;
    await typeIntoHostPty(window, shellThread.id, 'printf ZCC_WT_SHELL_MARKER > e2e-shell-marker.txt\n', shellTerm);
    await expect.poll(() => [
      join(projectDir, 'src', 'e2e-shell-marker.txt'),
      join(projectDir, 'e2e-shell-marker.txt'),
      join(worktreePath, 'src', 'e2e-shell-marker.txt'),
      join(worktreePath, 'e2e-shell-marker.txt')
    ].some((path) => existsSync(path)), { timeout: 15_000 }).toBe(true);

    for (const row of await listProductThreads(window)) {
      await archiveThread(window, row.id);
    }
    await expect.poll(() => existsSync(worktreePath), { timeout: 20_000 }).toBe(false);
  } finally {
    rmSync(projectDir, { recursive: true, force: true });
    agent.cleanup();
  }
});

test('worktreeinclude copies .env and a failing setup script rolls back', async ({ app }) => {
  const { window, home } = app;
  const agent = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' });
  const { dir: includeDir, name: includeName } = initGitProject('zcc-wt-inc-', home);
  writeFileSync(join(includeDir, '.worktreeinclude'), '.env\n');
  writeFileSync(join(includeDir, '.env'), 'SECRET=copied\n');
  const { dir: failDir, name: failName } = initGitProject('zcc-wt-fail-', home);
  writeFileSync(join(failDir, '.zcc-env-setup.sh'), '#!/bin/sh\nexit 1\n');
  chmodSync(join(failDir, '.zcc-env-setup.sh'), 0o755);
  git(failDir, ['add', '.zcc-env-setup.sh']);
  git(failDir, ['commit', '-m', 'setup']);
  const before = new Set(listManagedWorktreePaths(home));

  try {
    await prepareClaudeAndProject(window, home, agent.path, includeDir);
    await addProjectAndWait(window, failDir);

    await openWorktreeLauncher(window, includeName, 'copy env into the worktree');
    await window.locator('[data-testid="launch-send"]').click();
    await openLaunchedAgent(window, 'copy env into the worktree');
    await expect.poll(() => listManagedWorktreePaths(home).filter((path) => !before.has(path)).length, {
      timeout: 30_000
    }).toBeGreaterThan(0);
    const includeWorktree = listManagedWorktreePaths(home).filter((path) => !before.has(path))[0]!;
    expect(readFileSync(join(includeWorktree, '.env'), 'utf8')).toBe('SECRET=copied\n');
    for (const row of await listProductThreads(window)) {
      await archiveThread(window, row.id);
    }
    await window.locator('[data-testid="agent-terminal-modal"]').getByLabel('Close').click();
    await expect(window.locator('[data-testid="agent-terminal-modal"]')).toBeHidden();

    const afterInclude = new Set(listManagedWorktreePaths(home));
    await openWorktreeLauncher(window, failName, 'this setup should roll back');
    await window.locator('[data-testid="launch-send"]').click();
    await expect(window.locator('[data-testid="launch-modal"]')).toBeVisible({ timeout: 15_000 });
    await expect.poll(() => listManagedWorktreePaths(home).filter((path) => !afterInclude.has(path)).length, {
      timeout: 20_000
    }).toBe(0);
  } finally {
    rmSync(includeDir, { recursive: true, force: true });
    rmSync(failDir, { recursive: true, force: true });
    agent.cleanup();
  }
});
