/**
 * THROWAWAY screenshot capture for the "surface OpenCode agents across all launch
 * surfaces" proposal. Not a regression assertion — it drives the real launcher to
 * each of the four composer surfaces and the persona editor and writes PNGs to
 * e2e/.artifacts/agent-picker/ so we can build before/after UI mockups.
 *
 * Delete after the mockups are captured.
 */
import { test, expect } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

test.use({ e2e: true });

const OUT = fileURLToPath(new URL('./.artifacts/agent-picker/', import.meta.url));

test('capture the four launch composers + persona editor', async ({ app }) => {
  const { window } = app;
  mkdirSync(OUT, { recursive: true });

  const agent = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' });
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-picker-shots-proj-'));
  const projectName = basename(projectDir);
  let projectId: string | null = null;

  const shot = async (name: string, locator = window) => {
    await window.waitForTimeout(400);
    await locator.screenshot({ path: join(OUT, `${name}.png`) });
    // eslint-disable-next-line no-console
    console.log(`SHOT ${name} -> ${join(OUT, `${name}.png`)}`);
  };

  try {
    await window.evaluate((bin) => window.cc.config.set({
      teamJobLaunchEnabled: true,
      harnessOpenCodeEnabled: true,
      sponsorPromptDismissed: true,
      claudeBinary: bin,
      defaultHarness: 'claude'
    }), agent.path);

    await window.evaluate(() => window.cc.personas.save({
      id: 'shot-orchestrator',
      name: 'Shot Orchestrator',
      description: 'Persona for screenshot capture',
      baseProfile: 'claude',
      permissionMode: 'default',
      systemPrompt: ''
    }));
    await window.evaluate(() => window.cc.teams.save({
      id: 'shot-team',
      name: 'Shot Team',
      description: 'Team for screenshot capture',
      slots: [{ personaId: 'shot-orchestrator' }],
      orchestratorPersonaId: 'shot-orchestrator'
    }));

    projectId = await window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as { id: string };
      return proj.id;
    }, projectDir);
    expect(projectId).toBeTruthy();

    await window.locator('[data-testid="nav-agents"]').click();
    await window.locator('[data-testid="agents-board-new-thread"]').first().click();
    const modal = window.locator('[data-testid="launch-modal"]');
    await expect(modal).toBeVisible();

    // --- Modern ---
    await modal.getByRole('button', { name: 'Modern' }).click();
    await shot('01-modern', modal);

    // --- CLI Agent ---
    await modal.getByRole('button', { name: 'CLI Agent' }).click();
    await shot('02-cli-agent', modal);
    // Try to reveal the OpenCode family + Customize launch routing fields.
    const opencodeFamily = modal.getByRole('button', { name: /opencode/i });
    if (await opencodeFamily.count()) {
      await opencodeFamily.first().click();
      await shot('02b-cli-agent-opencode-family', modal);
    }
    const customize = modal.getByRole('button', { name: /Customize launch/i });
    if (await customize.count()) {
      await customize.first().click();
      await shot('02c-cli-agent-customize-launch', modal);
    }
    const roleSelect = modal.locator('#launch-role-target');
    if (await roleSelect.count()) {
      await roleSelect.scrollIntoViewIfNeeded();
      await shot('02d-cli-agent-role-picker', modal);
    }

    // --- Autonomous Team ---
    const autoBtn = modal.getByRole('button', { name: /Autonomous Team/i });
    if (await autoBtn.count()) {
      await autoBtn.first().click();
      await shot('03-autonomous-team', modal);
    }

    // --- Job Team ---
    const jobBtn = modal.getByRole('button', { name: 'Job Team' });
    if (await jobBtn.count()) {
      await jobBtn.first().click();
      await shot('04-job-team', modal);
    }

    // Close modal, capture the whole home shell for context.
    await window.keyboard.press('Escape').catch(() => {});
    await window.waitForTimeout(300);

    // --- Persona editor (harness routing / Native role field) ---
    // Reachable from Settings → Personas, or a personas rail; try a few entry points.
    const settingsLink = window.getByRole('link', { name: 'Settings' });
    if (await settingsLink.count()) {
      await settingsLink.first().click();
      await window.waitForTimeout(400);
      const personasItem = window.locator('.settings-section-item').filter({ hasText: /Personas|Squad|Teams/i });
      if (await personasItem.count()) {
        await personasItem.first().click();
        await window.waitForTimeout(400);
        await shot('05-personas-settings', window);
      }
      // Open the seeded persona for editing if an edit affordance exists.
      const editPersona = window.getByRole('button', { name: /Shot Orchestrator|Edit/i });
      if (await editPersona.count()) {
        await editPersona.first().click();
        await window.waitForTimeout(400);
        await shot('06-persona-editor', window);
      }
    }
  } finally {
    if (projectId) {
      await window.evaluate(async (pid) => {
        try {
          const sessions = (await window.cc.terminals.list?.(pid)) as Array<{ id: string }> | undefined;
          if (Array.isArray(sessions)) for (const s of sessions) { try { await window.cc.terminals.close(s.id); } catch { /* noop */ } }
        } catch { /* noop */ }
        try { await window.cc.projects.remove(pid); } catch { /* noop */ }
      }, projectId);
    }
    agent.cleanup();
    try { rmSync(projectDir, { recursive: true, force: true }); } catch { /* noop */ }
  }
});
