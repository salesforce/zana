/**
 * REAL agent-launch UI flow — driven through the DOM the way a user drives it,
 * NOT through `window.cc.*` IPC. This is the spec the earlier IPC-only specs
 * were missing: it clicks the actual buttons, types into the actual instruction
 * box, picks a profile, and hits Send, then asserts the launched agent surfaces
 * in the UI and streams live output.
 *
 *   Agents nav (data-testid="nav-agents")
 *     → "New agent" (data-testid="agents-new" / "agents-new-empty")
 *     → launcher modal (data-testid="launch-modal")
 *         → CLI Agent
 *         → instruction textarea (data-testid="launch-instruction")
 *         → target project select (aria-label="Target project")
 *         → harness select (aria-label="Launch harness")
 *         → Launch agent (aria-label="Launch agent")
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
import { test, expect } from './fixtures/app.js';
import { makeFakeAgentBinary } from './sdk/harness.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({ e2e: true });

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
  const projectName = basename(projectDir);
  let projectId: string | null = null;

  try {
    // Point the claude profile at the stub BEFORE launching. (config.set is the
    // one unavoidable IPC — there's no UI to set a binary path; everything else
    // below is real DOM interaction.)
    await window.evaluate((bin) => window.cc.config.set({
      claudeBinary: bin,
      defaultHarness: 'claude'
    }), agent.path);
    // The launcher hides uninstalled harnesses. Config changes do not update its
    // cached verification result, so mount Code Harness to re-probe fake Claude
    // before opening the modal. This matches the user-visible Settings refresh.
    await window.getByRole('link', { name: 'Settings' }).click();
    await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
    const claudeSettings = window.locator('#settings-anchor-harness-claude');
    await expect(claudeSettings).not.toHaveClass(/opener-row--off/);
    // Mounting this tab starts an async `--version` probe. Wait for its success,
    // not merely the always-visible Claude settings row, before opening the
    // launcher; unverified/missing harnesses are intentionally hidden there.
    await expect(claudeSettings.locator('.opener-row-status')).toHaveClass(/opener-row-status--ok/);
    // Settings replaces the global rail with its own section nav; leave it via
    // the Back link before the global Agents rail entry is reachable again.
    await window.locator('.settings-app-back').click();

    projectId = await window.evaluate(async (path) => {
      const res = await window.cc.projects.add(path);
      const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
        id: string;
      };
      return proj.id;
    }, projectDir);
    expect(projectId).toBeTruthy();

    // In-app `projects.add` broadcasts `projects:onChanged`, so the renderer
    // store picks up our tmp project live and the launcher's Target-project
    // picker lists it — no manual reload needed.

    // 1. Click the Agents rail entry.
    await window.locator('[data-testid="nav-agents"]').click();

    // 2. Open the launcher. The global Agents board renders the "New agent"
    //    button in both its header and its empty state, both with this testid
    //    and both flipping useUi.launcherOpen — click whichever is first.
    await window.locator('[data-testid="agents-board-new-thread"]').first().click();

    // 3. The launcher modal is up; switch to CLI Agent for the PTY path.
    const modal = window.locator('[data-testid="launch-modal"]');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'CLI Agent' }).click();

    // 4. Type an instruction into the CLI agent composer editor (TipTap).
    const instruction = modal.getByTestId('legacy-agent-command-input');
    await instruction.click();
    await instruction.fill('run the smoke check and report');
    await expect(instruction).toContainText('run the smoke check and report');

    // 5. Pick the target project through the composer's Project picklist.
    const targetProject = modal.getByRole('button', { name: 'Project' });
    await targetProject.click();
    await window
      .getByRole('listbox', { name: 'Project' })
      .getByRole('option', { name: projectName, exact: true })
      .click();
    await expect(targetProject).toContainText(projectName);

    // 6. Harness is auto-resolved from the configured default (claude, pointed at
    // the fake binary above); the composer flips its send button to enabled once
    // effectiveDefault resolves. Send — this calls createTerminal.
    const send = modal.getByTestId('legacy-agent-command-send');
    await expect(send).toBeEnabled({ timeout: 15_000 });
    await send.click();

    // 8. The launcher closes and the agent-inspector modal opens on the new
    //    session (AgentsView.onLauncherLaunched → openAgentModal).
    await expect(modal).toBeHidden();
    const agentModal = window.locator('[data-testid="agent-terminal-modal"]');
    await expect(agentModal).toBeVisible({ timeout: 15_000 });

    // 9. REAL rendered output: the live state chip reflects the OSC-driven
    //    status. The stub emits the braille spinner first → `working`.
    const stateChip = agentModal.locator('[data-testid="agent-modal-state"]');
    await expect(stateChip).toHaveAttribute('data-state', 'working', { timeout: 15_000 });
    await expect(agentModal.getByTestId('agent-modal-header')).toBeVisible();
    await expect(agentModal.getByTestId('agent-session-view')).toBeVisible();
    await expect(agentModal.getByTestId('thread-secondary-show')).toBeVisible();
    await expect(agentModal.getByTestId('thread-secondary-panel')).toHaveCount(0);
    await agentModal.getByTestId('thread-secondary-show').click();
    await expect(agentModal.getByTestId('thread-secondary-panel')).toBeVisible();
    await expect(agentModal.getByTestId('thread-info-pin')).toBeVisible();
    await expect(agentModal.getByRole('button', { name: 'Close Session' })).toBeVisible();

    // 10. Secondary confirmation on the live event timeline: main classified the
    //     session `working` and pushed it. (The DOM assertion above already
    //     proves the UI reflects it; this proves the source-of-truth push.)
    await events.waitForEvent(
      (e) =>
        e.channel === 'terminals:onAgentStatus' &&
        JSON.stringify(e.args).includes('working'),
      15_000
    );

    // 11. The global List monitor owns the agent list. Its list must expand into
    // column 2 instead of leaving the compact quick-agent list beside a duplicate.
    await agentModal.getByLabel('Close').click();
    await window.getByLabel('List view').click();
    await expect(window.locator('.app-shell')).toHaveClass(/scoped-no-list/);
    await expect(window.locator('.agents-list-pane')).toHaveCount(0);
    await expect(window.locator('.agent-monitor-list')).toBeVisible();
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
