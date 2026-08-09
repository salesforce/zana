/**
 * REAL agent-launch UI flow — driven through the DOM the way a user drives it,
 * NOT through `window.cc.*` IPC. This is the spec the earlier IPC-only specs
 * were missing: it clicks the actual buttons, types into the actual instruction
 * box, picks a profile, and hits Send, then asserts the launched agent surfaces
 * in the UI and streams live output.
 *
 *   Agents nav (data-testid="nav-agents")
 *     → "New quick agent" (data-testid="agents-new" / "agents-new-empty")
 *     → launcher modal (data-testid="launch-modal")
 *         → instruction textarea (data-testid="launch-instruction")
 *         → target project select (aria-label="Target project")
 *         → profile button (data-testid="launch-profile-claude")
 *         → Send (data-testid="launch-send")
 *     → agent-inspector modal (data-testid="agent-terminal-modal")
 *         → live state chip (data-testid="agent-modal-state", data-state=…)
 *
 * The `claude` profile binary is pointed at a fake stub (makeFakeAgentBinary,
 * `work-then-idle`) that emits Claude's braille-spinner OSC title, so main's
 * AgentStatusTracker classifies the session `working` then `idle` — a
 * deterministic, observable "output" without a real model. We assert BOTH the
 * rendered DOM (the modal + its `data-state`) AND, as a secondary timing signal,
 * the live `terminals:onAgentStatus` timeline via the EventRecorder.
 *
 * macOS caveat (same as agent-status-hydrate): the app resolves
 * ~/.zcc via app.getPath('home'), so `config.set(claudeBinary)` writes the REAL
 * ~/.zcc — the fixture snapshots/restores config.json; we remove the tmp project
 * we register in `finally`.
 */
import { test, expect } from './fixtures/app';
import { makeFakeAgentBinary } from './sdk/harness';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.use({ e2e: true });

test('Quick prompt New form stays vertically scrollable with Agent routing controls', async ({ app }) => {
  const { window } = app;
  await window.locator('[data-testid="nav-agents"]').click();
  const newBtn = window.locator('[data-testid="agents-new"]');
  if (await newBtn.count()) await newBtn.click();
  else await window.locator('[data-testid="agents-new-empty"]').click();

  const modal = window.locator('[data-testid="launch-modal"]');
  await modal.getByRole('button', { name: 'New', exact: true }).click();
  await expect(modal.getByRole('group', { name: 'New quick prompt' })).toBeVisible();
  await expect(modal.locator('[data-testid="launch-profile-default"]')).toBeVisible();

  const geometry = await modal.evaluate((element) => {
    const panel = element.querySelector<HTMLElement>('.launch-panel');
    if (!panel) throw new Error('launch panel missing');
    const style = getComputedStyle(panel);
    return {
      overflowY: style.overflowY,
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight
    };
  });
  expect(geometry.overflowY).toBe('auto');
  expect(geometry.scrollHeight).toBeGreaterThan(geometry.clientHeight);
  await modal.locator('[data-testid="launch-send"]').scrollIntoViewIfNeeded();
  await expect(modal.locator('[data-testid="launch-send"]')).toBeVisible();
});

test('Agent routing switches between portable defaults and harness-native Persona values', async ({ app }) => {
  const { window } = app;
  const personaId = `e2e-agent-routing-${Date.now()}`;
  try {
    const saved = await window.evaluate((id) => window.cc.personas.save({
      id,
      name: 'E2E Native Routing',
      baseProfile: 'opencode',
      harnessRouting: {
        schemaVersion: 1,
        byAdapter: {
          opencode: {
            providerTargetId: 'anthropic',
            modelTargetId: 'aisuite/us.anthropic.claude-sonnet-5',
            executionState: 'plan'
          }
        }
      }
    }), personaId);
    expect(saved.ok).toBe(true);

    await window.locator('[data-testid="nav-agents"]').click();
    const newBtn = window.locator('[data-testid="agents-new"]');
    if (await newBtn.count()) await newBtn.click();
    else await window.locator('[data-testid="agents-new-empty"]').click();

    const modal = window.locator('[data-testid="launch-modal"]');
    await expect(modal.locator('[data-testid="launch-profile-default"]')).toHaveClass(/active/);
    await expect(modal.locator('[data-testid="launch-portable-routing"]')).toBeVisible();
    await expect(modal.locator('[data-testid="launch-native-routing"]')).toHaveCount(0);

    const openCode = modal.locator('[data-testid="launch-profile-opencode"]');
    await expect(openCode).toHaveCount(1);
    await openCode.click();
    await expect(modal.locator('[data-testid="launch-portable-routing"]')).toHaveCount(0);
    await expect(modal.locator('[data-testid="launch-native-routing"]')).toBeVisible();
    await expect(modal.locator('#launch-provider-target')).toBeVisible();
    await expect(modal.locator('#launch-model-target')).toBeVisible();

    await modal.locator('.launch-advanced-toggle').click();
    await modal.getByRole('button', { name: 'E2E Native Routing', exact: true }).click();
    await expect(openCode).toHaveClass(/active/);
    await expect(modal.locator('#launch-provider-target')).toHaveValue('anthropic');
    await expect(modal.locator('#launch-model-target')).toHaveValue('aisuite/us.anthropic.claude-sonnet-5');
    await expect(modal.locator('#launch-native-execution')).toHaveValue('plan');

    await modal.locator('#launch-provider-target').selectOption('openai');
    await modal.locator('#launch-model-target').selectOption('aisuite/gpt-5.6-sol');
    await modal.locator('#launch-native-execution').selectOption('autonomous');
    await expect(modal.locator('#launch-model-target')).toHaveValue('aisuite/gpt-5.6-sol');
    await expect(modal.locator('#launch-native-execution')).toHaveValue('autonomous');

    await modal.locator('#launch-provider-target').selectOption('');
    await expect(modal.locator('#launch-provider-target')).toHaveValue('');
    await expect(modal.locator('#launch-model-target')).toHaveValue('');

    await modal.locator('[data-testid="launch-profile-default"]').click();
    await expect(modal.locator('[data-testid="launch-portable-routing"]')).toBeVisible();
    await expect(modal.locator('[data-testid="launch-native-routing"]')).toHaveCount(0);
  } finally {
    await window.evaluate(async (id) => {
      try { await window.cc.personas.delete(id); } catch { /* best-effort */ }
    }, personaId);
  }
});

test('launching an agent through the real UI opens its terminal and it goes working', async ({
  app,
  events
}) => {
  const { window } = app;

  // A fake `claude` that emits the working spinner, then settles to idle and
  // holds — drives a real PTY through the working→idle lanes with no model call.
  const agent = makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' });

  // A real, registered project to launch into (so we don't depend on the scratch
  // workspace being creatable in the sandbox). Removed in `finally`.
  const projectDir = mkdtempSync(join(tmpdir(), 'zcc-launch-ui-proj-'));
  let projectId: string | null = null;

  try {
    // Point the claude profile at the stub BEFORE launching. (config.set is the
    // one unavoidable IPC — there's no UI to set a binary path; everything else
    // below is real DOM interaction.)
    await window.evaluate((bin) => window.cc.config.set({ claudeBinary: bin }), agent.path);

    projectId = await window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
        id: string;
      };
      return proj.id;
    }, projectDir);
    expect(projectId).toBeTruthy();

    // `projects.add` persists in main but doesn't broadcast `projects:onChanged`
    // (only the renderer's own addProject action reloads). Land on Projects and
    // click Reload so the renderer store picks up our tmp project — otherwise the
    // launcher's Target-project <select> won't list it.
    await window.locator('[data-testid="nav-projects"]').click();
    await window.locator('button[aria-label="Reload project list"]').click();

    // 1. Click the Agents rail entry.
    await window.locator('[data-testid="nav-agents"]').click();

    // 2. Open the launcher — the header "+" when agents already exist, else the
    //    empty-state primary button. Whichever is present.
    const newBtn = window.locator('[data-testid="agents-new"]');
    const newEmptyBtn = window.locator('[data-testid="agents-new-empty"]');
    if (await newBtn.count()) {
      await newBtn.click();
    } else {
      await newEmptyBtn.click();
    }

    // 3. The launcher modal is up.
    const modal = window.locator('[data-testid="launch-modal"]');
    await expect(modal).toBeVisible();

    // 4. Type an instruction into the real composer textarea.
    const instruction = modal.locator('[data-testid="launch-instruction"]');
    await instruction.fill('run the smoke check and report');
    await expect(instruction).toHaveValue('run the smoke check and report');

    // 5. Pick the target project (our tmp project) via the real <select>.
    await modal.getByLabel('Target project').selectOption(projectId!);

    // 6. Select the claude HARNESS FAMILY explicitly (it's the default, but click
    //    it as a user would to prove the family picker works). The launcher now
    //    separates harness family from a Normal/Yolo permission axis.
    await modal.locator('[data-testid="launch-profile-claude"]').click();

    // 6b. The Normal/Yolo mode row is a separate control. Normal is the default;
    //     Yolo is enabled for claude (it has a --dangerously-skip-permissions
    //     bypass profile). Prove the axis is independent of the family picker by
    //     toggling to Yolo and back to Normal before launching.
    const modeYolo = modal.locator('[data-testid="launch-mode-yolo"]');
    const modeNormal = modal.locator('[data-testid="launch-mode-normal"]');
    await expect(modeNormal).toHaveClass(/active/);
    await expect(modeYolo).toBeEnabled();
    await modeYolo.click();
    await expect(modeYolo).toHaveClass(/active/);
    await modeNormal.click();
    await expect(modeNormal).toHaveClass(/active/);

    // 6c. PI has no permission-bypass flag, so selecting the PI family disables
    //     the Yolo toggle (only --approve exists, which trusts project files and
    //     is not a bypass). Prove it, then return to claude for the real launch.
    const piFamily = modal.locator('[data-testid="launch-profile-pi"]');
    if (await piFamily.count()) {
      await piFamily.click();
      await expect(modeYolo).toBeDisabled();
      await modal.locator('[data-testid="launch-profile-claude"]').click();
      await expect(modeYolo).toBeEnabled();
    }

    // 7. Send. This is the real launch button — it calls doCreate → createTerminal.
    await modal.locator('[data-testid="launch-send"]').click();

    // 8. The launcher closes and the agent-inspector modal opens on the new
    //    session (AgentsView.onLauncherLaunched → openAgentModal).
    await expect(modal).toBeHidden();
    const agentModal = window.locator('[data-testid="agent-terminal-modal"]');
    await expect(agentModal).toBeVisible({ timeout: 15_000 });

    // 9. REAL rendered output: the live state chip reflects the OSC-driven
    //    status. The stub emits the braille spinner first → `working`.
    const stateChip = agentModal.locator('[data-testid="agent-modal-state"]');
    await expect(stateChip).toHaveAttribute('data-state', 'working', { timeout: 15_000 });

    // 10. Secondary confirmation on the live event timeline: main classified the
    //     session `working` and pushed it. (The DOM assertion above already
    //     proves the UI reflects it; this proves the source-of-truth push.)
    await events.waitForEvent(
      (e) =>
        e.channel === 'terminals:onAgentStatus' &&
        JSON.stringify(e.args).includes('working'),
      15_000
    );
  } finally {
    // Best-effort: close the agent (frees the held PTY), then remove the project.
    if (projectId) {
      await window.evaluate(async (pid) => {
        try {
          const sessions = (await window.cc.terminals.list?.(pid)) as
            | Array<{ id: string }>
            | undefined;
          if (Array.isArray(sessions)) {
            for (const s of sessions) {
              try {
                await window.cc.terminals.close(s.id);
              } catch {
                /* best-effort */
              }
            }
          }
        } catch {
          /* best-effort */
        }
        try {
          await window.cc.projects.remove(pid);
        } catch {
          /* best-effort */
        }
      }, projectId);
    }
    agent.cleanup();
    try {
      rmSync(projectDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }
});
