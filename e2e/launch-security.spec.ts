import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from './fixtures/app';
import { makeFakeAgentBinary } from './sdk/harness';
import { nativeDialogCalls, stubNativeDialogs } from './sdk/native-dialog';

const fakeSshDir = mkdtempSync(join(tmpdir(), 'zcc-fake-ssh-'));
const fakeSsh = join(fakeSshDir, 'ssh');
writeFileSync(fakeSsh, '#!/bin/sh\nprintf "remote session ready\\n"\nwhile true; do sleep 3600; done\n');
chmodSync(fakeSsh, 0o755);

test.use({
  e2e: true,
  launchEnv: { PATH: `${fakeSshDir}:${process.env.PATH ?? ''}` }
});
test.afterAll(() => rmSync(fakeSshDir, { recursive: true, force: true }));

async function addProject(window: import('@playwright/test').Page, path: string): Promise<string> {
  return window.evaluate(async (projectPath) => {
    const result = await window.cc.projects.add(projectPath);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, path);
}

test('renderer launch requires native confirmation and Agent Launcher retains backend error for retry', async ({ app }) => {
  const { window, electron } = app;
  const agent = makeFakeAgentBinary({ sequence: 'working-hold' });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-launch-confirm-'));
  let projectId: string | null = null;

  try {
    await stubNativeDialogs(electron, [1, 0]);
    await window.evaluate((binary) => window.cc.config.set({ claudeBinary: binary }), agent.path);
    projectId = await addProject(window, projectDir);
    await window.locator('[data-testid="nav-projects"]').click();
    await window.locator('button[aria-label="Reload project list"]').click();
    await window.locator('[data-testid="nav-agents"]').click();
    const open = window.locator('[data-testid="agents-new"]');
    if (await open.count()) await open.click();
    else await window.locator('[data-testid="agents-new-empty"]').click();

    const modal = window.locator('[data-testid="launch-modal"]');
    const instruction = modal.locator('[data-testid="launch-instruction"]');
    await instruction.fill('retain this draft after denied launch');
    await modal.getByLabel('Target project').selectOption(projectId);
    await modal.locator('[data-testid="launch-send"]').click();

    await expect(modal).toBeVisible();
    await expect(instruction).toHaveValue('retain this draft after denied launch');
    await expect(modal.getByRole('alert')).toHaveText('terminal launch was not confirmed');
    await expect(modal.locator('[data-testid="launch-send"]')).toHaveAttribute('aria-describedby', 'agent-launch-status');
    expect(await window.evaluate((id) => window.cc.terminals.list(id), projectId)).toHaveLength(0);

    await modal.locator('[data-testid="launch-send"]').click();
    await expect(modal).toBeHidden();
    await expect(window.locator('[data-testid="agent-terminal-modal"]')).toBeVisible({ timeout: 20_000 });

    const calls = await nativeDialogCalls(electron);
    expect(calls.map((call) => call.title)).toEqual(['Launch terminal?', 'Launch terminal?']);
    expect(calls[0]).toMatchObject({
      message: 'Allow this renderer to launch a terminal?',
      buttons: ['Launch', 'Cancel'],
      defaultId: 1,
      cancelId: 1
    });
    expect(calls[0].detail).toContain(`Project: ${projectId}`);
    expect(calls[0].detail).toContain('Profile: claude');
  } finally {
    if (projectId) {
      await window.evaluate(async (id) => {
        for (const session of await window.cc.terminals.list(id)) {
          try { await window.cc.terminals.close(session.id); } catch { /* best-effort */ }
        }
        try { await window.cc.projects.remove(id); } catch { /* best-effort */ }
      }, projectId);
    }
    agent.cleanup();
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('Agent Launcher retains structured preflight error and draft', async ({ app }) => {
  const { window, electron } = app;
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-launch-preflight-'));
  let projectId: string | null = null;

  try {
    await stubNativeDialogs(electron, [0]);
    projectId = await addProject(window, projectDir);
    await window.locator('[data-testid="nav-projects"]').click();
    await window.locator('button[aria-label="Reload project list"]').click();
    await window.locator('[data-testid="nav-settings"]').click();
    await window.locator('.settings-section-item').filter({ hasText: 'Experimental' }).click();
    const structuredRouting = window.getByLabel('Structured harness routing');
    if (!(await structuredRouting.isChecked())) await structuredRouting.check();
    await expect.poll(() => window.evaluate(async () => (await window.cc.config.get()).structuredRoutingEnabled)).toBe(true);
    await window.locator('[data-testid="nav-agents"]').click();
    const open = window.locator('[data-testid="agents-new"]');
    if (await open.count()) await open.click();
    else await window.locator('[data-testid="agents-new-empty"]').click();

    const modal = window.locator('[data-testid="launch-modal"]');
    const instruction = modal.locator('[data-testid="launch-instruction"]');
    await instruction.fill('retain preflight failure draft');
    await modal.getByLabel('Target project').selectOption(projectId);
    await expect(modal.locator('[data-testid="launch-portable-routing"]')).toBeVisible();
    await modal.locator('#launch-execution-state').selectOption('plan');
    await modal.locator('[data-testid="launch-send"]').click();

    await expect(modal).toBeVisible();
    await expect(instruction).toHaveValue('retain preflight failure draft');
    await expect(modal.getByRole('alert')).toHaveText(
      'Structured execution unavailable: candidate target evidence'
    );
    expect(await window.evaluate((id) => window.cc.terminals.list(id), projectId)).toHaveLength(0);
    expect((await nativeDialogCalls(electron)).map((call) => call.title)).toEqual(['Launch terminal?']);
  } finally {
    if (projectId) {
      await window.evaluate(async (id) => {
        try { await window.cc.projects.remove(id); } catch { /* best-effort */ }
      }, projectId);
    }
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('restore capability releases on cancellation, consumes on success, and rejects replay', async ({ app }) => {
  const { window, electron } = app;
  const agent = makeFakeAgentBinary({ sequence: 'working-hold' });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-restore-cap-'));
  let projectId: string | null = null;

  try {
    await stubNativeDialogs(electron, [0, 1, 0]);
    await window.evaluate((binary) => window.cc.config.set({ claudeBinary: binary }), agent.path);
    projectId = await addProject(window, projectDir);

    const created = await window.evaluate(async (id) => window.cc.terminals.create({
      projectId: id,
      profile: 'claude',
      cols: 80,
      rows: 24,
      title: 'Capability probe'
    }), projectId);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.message);
    expect(created.value.restoreCapabilityId).toBeTruthy();
    const capabilityId = created.value.restoreCapabilityId!;
    await window.evaluate((sessionId) => window.cc.terminals.close(sessionId), created.value.id);

    const cancelled = await window.evaluate((id) => window.cc.terminals.restore({ capabilityId: id }), capabilityId);
    expect(cancelled).toEqual({ ok: false, code: 'CANCELLED', message: 'terminal restore was not confirmed' });

    const retried = await window.evaluate((id) => window.cc.terminals.restore({ capabilityId: id }), capabilityId);
    expect(retried.ok).toBe(true);

    const replay = await window.evaluate((id) => window.cc.terminals.restore({ capabilityId: id }), capabilityId);
    expect(replay).toEqual({
      ok: false,
      code: 'DENIED',
      message: 'restore capability unavailable or already reserved'
    });

    const calls = await nativeDialogCalls(electron);
    expect(calls.map((call) => call.title)).toEqual([
      'Launch terminal?',
      'Restore terminal?',
      'Restore terminal?'
    ]);
    expect(calls[1].detail).toContain('Profile: claude');
    expect(calls[1].detail).toContain('Sanitized arguments: "--resume"');
    expect(calls[1]).toMatchObject({ buttons: ['Restore', 'Cancel'], defaultId: 1, cancelId: 1 });
  } finally {
    if (projectId) {
      await window.evaluate(async (id) => {
        for (const session of await window.cc.terminals.list(id)) {
          try { await window.cc.terminals.close(session.id); } catch { /* best-effort */ }
        }
        try { await window.cc.projects.remove(id); } catch { /* best-effort */ }
      }, projectId);
    }
    agent.cleanup();
    rmSync(projectDir, { recursive: true, force: true });
  }
});

test('reconnect capability releases on cancellation, consumes on success, and rejects replay', async ({ app }) => {
  const { window, electron } = app;
  let projectId: string | null = null;

  try {
    await stubNativeDialogs(electron, [0, 1, 0]);
    await window.evaluate(() => window.cc.config.set({ tmuxPersistence: true }));
    const added = await window.evaluate(() => window.cc.projects.addRemote({
      host: 'e2e.invalid',
      remotePath: '/tmp',
      name: 'E2E reconnect target'
    }));
    expect(added.ok).toBe(true);
    if (!added.ok) throw new Error(added.message);
    projectId = added.value.id;

    const created = await window.evaluate(async (id) => window.cc.terminals.create({
      projectId: id,
      profile: 'claude',
      cols: 80,
      rows: 24,
      title: 'Remote capability probe'
    }), projectId);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.message);
    expect(created.value.restoreCapabilityId).toBeTruthy();
    expect(created.value.remoteTmuxId).toBeTruthy();
    const capabilityId = created.value.restoreCapabilityId!;
    await window.evaluate((sessionId) => window.cc.terminals.close(sessionId), created.value.id);

    const cancelled = await window.evaluate((id) => window.cc.terminals.reconnectRemote({ capabilityId: id }), capabilityId);
    expect(cancelled).toEqual({ ok: false, code: 'CANCELLED', message: 'terminal reconnect was not confirmed' });

    const retried = await window.evaluate((id) => window.cc.terminals.reconnectRemote({ capabilityId: id }), capabilityId);
    expect(retried.ok).toBe(true);

    const replay = await window.evaluate((id) => window.cc.terminals.reconnectRemote({ capabilityId: id }), capabilityId);
    expect(replay).toEqual({
      ok: false,
      code: 'DENIED',
      message: 'reconnect capability unavailable or already reserved'
    });

    const calls = await nativeDialogCalls(electron);
    expect(calls.map((call) => call.title)).toEqual([
      'Launch terminal?',
      'Reconnect terminal?',
      'Reconnect terminal?'
    ]);
    expect(calls[1].detail).toContain('Session: Remote capability probe');
    expect(calls[1].detail).toContain(`Target: cc-${created.value.remoteTmuxId}`);
    expect(calls[1]).toMatchObject({ buttons: ['Reconnect', 'Cancel'], defaultId: 1, cancelId: 1 });
  } finally {
    if (projectId) {
      await window.evaluate(async (id) => {
        for (const session of await window.cc.terminals.list(id)) {
          try { await window.cc.terminals.close(session.id); } catch { /* best-effort */ }
        }
        try { await window.cc.projects.remove(id); } catch { /* best-effort */ }
      }, projectId);
    }
  }
});
