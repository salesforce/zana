/**
 * Windows production boundary for CLI Agents launched through a `.cmd` shim.
 *
 * A CLI Agent's argv (inbox guidance, hook settings) is over cmd.exe's
 * 8191-character cap, so a one-line forwarding `claude.cmd` (`@"…\x.exe" … %*`)
 * used to make every launch print "The command line is too long." and exit 1.
 * The host daemon now runs the exe the shim forwards to, without cmd.exe, and
 * a shim it can't unwrap fails before spawning with the limit named.
 *
 * The fake agent is the Playwright runner's own node.exe on a script, which is
 * exactly the shape of such a forwarder. Windows only; skips elsewhere.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, initialConfig: { tmuxScope: 'off', sponsorPromptDismissed: true } });
test.setTimeout(120_000);
test.skip(process.platform !== 'win32', 'cmd.exe shims exist only on Windows');

const READY = 'FAKE-CLAUDE-READY';
const CMD_LIMIT = 8191;
const SHIM_FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'host-daemon', 'src', 'harness', '__tests__', 'fixtures', 'windows-shims');

function writeAgent(dir: string, shimBody: (script: string) => string): string {
  mkdirSync(dir, { recursive: true });
  const script = join(dir, 'agent.cjs');
  // Prints how long the argv it received is, so the spec can tell the long
  // launch reached the agent intact.
  writeFileSync(script, `
if (process.argv.includes('--version')) { console.log('2.1.220 (Claude Code)'); process.exit(0); }
const args = process.argv.slice(2);
console.log('${READY} argc=' + args.length + ' chars=' + args.join(' ').length);
process.stdin.resume();
setInterval(() => {}, 1000);
`);
  const shim = join(dir, 'claude.cmd');
  writeFileSync(shim, shimBody(script));
  return shim;
}

async function launchAgent(page: Page, projectDir: string, bin: string) {
  mkdirSync(projectDir, { recursive: true });
  return page.evaluate(async ({ path, bin }) => {
    await window.cc.config.set({ claudeBinary: bin });
    const project = await window.cc.projects.add(path);
    if (!project.ok) throw new Error(project.message);
    const created = await window.cc.terminals.create({ projectId: project.value.id, profile: 'claude', title: 'Shim Agent', cols: 120, rows: 30 });
    return created.ok ? { ok: true as const, id: created.value.id } : { ok: false as const, message: created.message };
  }, { path: projectDir, bin });
}

test('a CLI Agent behind a forwarding claude.cmd starts with its full argv', async ({ app }) => {
  // Spaces in the folders, like a real profile path.
  const projectDir = join(app.home, 'shim project');
  const shim = writeAgent(join(app.home, 'agent bin'), (script) => `@"${process.execPath}" "${script}" %*\r\n`);
  const created = await launchAgent(app.window, projectDir, shim);
  expect(created.ok, created.ok ? '' : created.message).toBe(true);
  if (!created.ok) return;
  try {
    const backlog = () => app.window.evaluate((id) => window.cc.terminals.backlog(id), created.id);
    await expect.poll(backlog, { timeout: 30_000 }).toContain(READY);
    const text = await backlog();
    expect(text).not.toContain('The command line is too long');
    const chars = Number(text.match(/chars=(\d+)/)?.[1]);
    // Over cmd.exe's cap: this launch could not have gone through cmd.exe.
    expect(chars).toBeGreaterThan(CMD_LIMIT);
  } finally {
    // The fake agent never exits on its own; a live child keeps the isolated
    // runtime folder locked and the worker teardown fails with EPERM.
    await app.window.evaluate((id) => window.cc.terminals.close(id), created.id).catch(() => {});
  }
});

test('a CLI Agent behind an npm cmd-shim starts with its full argv', async ({ app }) => {
  // The real `npm install -g @openai/codex` shim, retargeted at the fake agent
  // (its own `node_modules\fake\agent.cjs`), with node.exe next to it as the
  // shim prefers.
  const projectDir = join(app.home, 'npm shim project');
  const npmDir = join(app.home, 'npm global');
  const npmShim = readFileSync(join(SHIM_FIXTURES, 'npm-codex.cmd'), 'utf8')
    .replace('\\node_modules\\@openai\\codex\\bin\\codex.js', '\\node_modules\\fake\\agent.cjs');
  expect(npmShim).toContain('\\node_modules\\fake\\agent.cjs');
  writeAgent(join(npmDir, 'node_modules', 'fake'), () => '');
  copyFileSync(process.execPath, join(npmDir, 'node.exe'));
  const shim = join(npmDir, 'claude.cmd');
  writeFileSync(shim, npmShim);
  const created = await launchAgent(app.window, projectDir, shim);
  expect(created.ok, created.ok ? '' : created.message).toBe(true);
  if (!created.ok) return;
  try {
    const backlog = () => app.window.evaluate((id) => window.cc.terminals.backlog(id), created.id);
    await expect.poll(backlog, { timeout: 30_000 }).toContain(READY);
    const text = await backlog();
    expect(text).not.toContain('The command line is too long');
    expect(Number(text.match(/chars=(\d+)/)?.[1])).toBeGreaterThan(CMD_LIMIT);
  } finally {
    await app.window.evaluate((id) => window.cc.terminals.close(id), created.id).catch(() => {});
  }
});

test('a shim that cannot be unwrapped fails before spawning, naming the limit', async ({ app }) => {
  const projectDir = join(app.home, 'complex shim project');
  const shim = writeAgent(join(app.home, 'complex bin'), (script) => `@echo off\r\nsetlocal\r\n"${process.execPath}" "${script}" %*\r\n`);
  const created = await launchAgent(app.window, projectDir, shim);
  expect(created.ok).toBe(false);
  if (created.ok) return;
  expect(created.message).toContain(`over the Windows limit of ${CMD_LIMIT}. It is a batch file`);
});
