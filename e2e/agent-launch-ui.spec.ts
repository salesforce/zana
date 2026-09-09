/**
 * REAL agent-launch UI flow — driven through the DOM the way a user drives it,
 * NOT through `window.cc.*` IPC. Parameterized across every CLI Agent family
 * and every Edits picker mode that family can spawn:
 *
 *   Claude  → Edits, Auto, Full Access (yolo / claude-yolo)
 *   Cursor  → Edits, Full Access (yolo / cursor-yolo); no Auto in catalog
 *   Codex   → Edits, Auto, Full Access (yolo / codex-yolo)
 *   Pi      → picker hidden (no unrestricted profile)
 *   OpenCode→ Edits, Full Access (yolo / opencode-yolo); no Auto in catalog
 *
 *   Agents nav (data-testid="nav-agents")
 *     → "New agent" (data-testid="agents-board-new-thread")
 *     → launcher modal (data-testid="launch-modal")
 *         → CLI Agent
 *         → instruction editor (data-testid="legacy-agent-command-input")
 *         → Project picklist
 *         → harness tab (data-testid="model-reasoning-provider-<id>")
 *         → Permission mode (when offered)
 *         → Launch agent (data-testid="legacy-agent-command-send")
 *     → agent-inspector modal (data-testid="agent-terminal-modal")
 *
 * Claude uses a fake stub that emits OSC working titles. The other families use
 * a generic hold stub (no OSC) — we assert the inspector opens, not `working`.
 *
 * macOS caveat: the app resolves ~/.zcc via app.getPath('home'). The e2e fixture
 * sandboxes HOME; we still remove the tmp project in `finally`.
 */
import { test, expect } from './fixtures/app.js';
import type { Locator, Page } from '@playwright/test';
import { makeFakeAgentBinary, makeFakeGenericHoldBinary } from './sdk/harness.js';
import { stubNativeDialogs } from './sdk/native-dialog.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

test.use({ e2e: true });

type BinaryKey = 'claudeBinary' | 'cursorBinary' | 'codexBinary' | 'piBinary' | 'opencodeBinary';
type EnableKey = 'harnessCursorEnabled' | 'harnessCodexEnabled' | 'harnessPiEnabled' | 'harnessOpenCodeEnabled';
type Family = 'claude' | 'cursor' | 'codex' | 'pi' | 'opencode';

type PermissionPick = {
  optionLabel: string;
  compactLabel: string;
};

type FamilySpec = {
  family: Family;
  providerId: string;
  binaryKey: BinaryKey;
  enableKey?: EnableKey;
  expectWorking: boolean;
  pickerOptions: readonly string[];
  modes: ReadonlyArray<PermissionPick | null>;
};

const ACCEPT_EDITS: PermissionPick = { optionLabel: 'Accept Edits', compactLabel: 'Edits' };
const APPROVE_FOR_ME: PermissionPick = { optionLabel: 'Approve for me', compactLabel: 'Auto' };
const FULL_ACCESS: PermissionPick = { optionLabel: 'Full Access', compactLabel: 'Full' };

const CLI_FAMILIES: readonly FamilySpec[] = [
  {
    family: 'claude',
    providerId: 'claude-code',
    binaryKey: 'claudeBinary',
    expectWorking: true,
    pickerOptions: ['Accept Edits', 'Approve for me', 'Full Access'],
    modes: [ACCEPT_EDITS, APPROVE_FOR_ME, FULL_ACCESS]
  },
  {
    family: 'cursor',
    providerId: 'acp-cursor',
    binaryKey: 'cursorBinary',
    enableKey: 'harnessCursorEnabled',
    expectWorking: false,
    pickerOptions: ['Accept Edits', 'Full Access'],
    modes: [ACCEPT_EDITS, FULL_ACCESS]
  },
  {
    family: 'codex',
    providerId: 'codex',
    binaryKey: 'codexBinary',
    enableKey: 'harnessCodexEnabled',
    expectWorking: false,
    pickerOptions: ['Accept Edits', 'Approve for me', 'Full Access'],
    modes: [ACCEPT_EDITS, APPROVE_FOR_ME, FULL_ACCESS]
  },
  {
    family: 'pi',
    providerId: 'pi',
    binaryKey: 'piBinary',
    enableKey: 'harnessPiEnabled',
    expectWorking: false,
    pickerOptions: [],
    modes: [null]
  },
  {
    family: 'opencode',
    providerId: 'acp-opencode',
    binaryKey: 'opencodeBinary',
    enableKey: 'harnessOpenCodeEnabled',
    expectWorking: false,
    pickerOptions: ['Accept Edits', 'Full Access'],
    modes: [ACCEPT_EDITS, FULL_ACCESS]
  }
];

const CLI_CASES = CLI_FAMILIES.flatMap((family) =>
  family.modes.map((permission) => ({
    ...family,
    permission,
    title: permission
      ? `${family.family} (${permission.compactLabel})`
      : `${family.family} (no picker)`
  }))
);

async function selectHarness(window: Page, modal: Locator, providerId: string) {
  const trigger = modal.locator('[data-testid="model-reasoning-picker-trigger"]');
  await expect(trigger).toBeVisible({ timeout: 30_000 });
  await trigger.click();
  const tab = window.locator(`[data-testid="model-reasoning-provider-${providerId}"]`);
  await expect(tab).toBeVisible({ timeout: 30_000 });
  await tab.click();
  await trigger.click();
}

async function selectPermissionMode(
  window: Page,
  modal: Locator,
  pick: PermissionPick,
  offeredLabels: readonly string[]
) {
  const trigger = modal.getByLabel('Permission mode');
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
  const menu = window.getByRole('listbox', { name: 'Permission mode' });
  await expect(menu).toBeVisible();
  for (const label of offeredLabels) {
    await expect(menu.getByRole('option', { name: label })).toBeVisible();
  }
  if (!offeredLabels.includes('Approve for me')) {
    await expect(menu.getByRole('option', { name: 'Approve for me' })).toHaveCount(0);
  }
  await menu.getByRole('option', { name: pick.optionLabel }).click();
  await expect(menu).toBeHidden();
  await expect(trigger).toContainText(pick.compactLabel);
}

async function probeHarness(window: Page, family: string, versionTitle: RegExp) {
  await window.getByRole('link', { name: 'Settings' }).click();
  await window.locator('.settings-section-item').filter({ hasText: 'Code Harness' }).click();
  const settings = window.locator(`#settings-anchor-harness-${family}`);
  await expect(settings).not.toHaveClass(/opener-row--off/);
  // Status rows render a version chip and a login chip. Target the version --ok
  // specifically (and the stub version) so a PATH CLI cannot satisfy the probe.
  const ok = settings.locator('.opener-row-status--ok').first();
  await expect(ok).toBeVisible({ timeout: 20_000 });
  await expect(ok).toHaveAttribute('title', versionTitle, { timeout: 20_000 });
  await window.locator('.settings-app-back').click();
}

async function cleanupLaunch(window: Page, projectId: string | null, projectDir: string) {
  if (projectId && !window.isClosed()) {
    try {
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
    } catch {
      /* app already gone */
    }
  }
  try {
    rmSync(projectDir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}

async function selectWorkMode(window: Page, modal: Locator, mode: 'agent' | 'plan') {
  const trigger = modal.getByTestId('composer-mode-picker-trigger');
  await expect(trigger).toBeVisible({ timeout: 15_000 });
  await trigger.click();
  const menu = window.getByTestId('composer-mode-picker-menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByTestId('composer-mode-agent')).toBeVisible();
  await expect(menu.getByTestId('composer-mode-plan')).toBeVisible();
  await window.getByTestId(`composer-mode-${mode}`).click();
  await expect(menu).toBeHidden();
}

for (const row of CLI_CASES) {
  test(`launching a ${row.title} CLI Agent through the real UI opens its terminal`, {
    timeout: 60_000
  }, async ({
    app,
    events
  }) => {
    const { window } = app;
    // Cursor/OpenCode Edits map to a closest-equivalence native policy, which
    // raises a main-process consent box before spawn. Stub "Allow once".
    await stubNativeDialogs(app.electron, [0]);
    const agent = row.expectWorking
      ? makeFakeAgentBinary({ profile: 'claude', sequence: 'work-then-idle' })
      : makeFakeGenericHoldBinary();
    const projectDir = mkdtempSync(join(tmpdir(), `zcc-launch-ui-${row.family}-`));
    const projectName = basename(projectDir);
    let projectId: string | null = null;
    const extraUi = row.expectWorking && row.permission?.compactLabel === 'Edits';

    try {
      const patch: Record<string, unknown> = {
        [row.binaryKey]: agent.path,
        defaultHarness: row.family
      };
      if (row.enableKey) patch[row.enableKey] = true;
      await window.evaluate(async (cfg) => {
        await window.cc.config.set(cfg);
      }, patch);
      await probeHarness(
        window,
        row.family,
          row.expectWorking ? /2\.1\.220/ : /^2026\.09\.02$/
      );

      projectId = await window.evaluate(async (path) => {
        const res = await window.cc.projects.add(path);
        const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
          id: string;
        };
        return proj.id;
      }, projectDir);
      expect(projectId).toBeTruthy();

      await window.locator('[data-testid="nav-agents"]').click();
      await window.locator('[data-testid="agents-board-new-thread"]').first().click();
      const modal = window.locator('[data-testid="launch-modal"]');
      await expect(modal).toBeVisible();
      await modal.getByRole('button', { name: 'CLI Agent' }).click();

      const instruction = modal.getByTestId('legacy-agent-command-input');
      await instruction.click();
      await instruction.fill('run the smoke check and report');
      await expect(instruction).toContainText('run the smoke check and report');

      const targetProject = modal.getByRole('button', { name: 'Project' });
      await targetProject.click();
      await window
        .getByRole('listbox', { name: 'Project' })
        .getByRole('option', { name: projectName, exact: true })
        .click();
      await expect(targetProject).toContainText(projectName);

      await selectHarness(window, modal, row.providerId);

      if (row.family === 'claude' || row.family === 'cursor' || row.family === 'codex') {
        await expect(modal.getByTestId('composer-mode-picker-trigger')).toBeVisible({ timeout: 15_000 });
        await expect(modal.getByTestId('composer-mode-picker-trigger')).toContainText('Agent');
        await expect(modal.getByTestId('native-role-picker-trigger')).toHaveCount(0);
      } else if (row.family === 'pi') {
        await expect(modal.getByTestId('composer-mode-picker-trigger')).toHaveCount(0);
        await expect(modal.getByTestId('native-role-picker-trigger')).toHaveCount(0);
      } else {
        await expect(modal.getByTestId('composer-mode-picker-trigger')).toHaveCount(0);
      }

      const send = modal.getByTestId('legacy-agent-command-send');
      await expect(send).toBeEnabled({ timeout: 15_000 });
      if (row.permission) {
        await selectPermissionMode(window, modal, row.permission, row.pickerOptions);
      } else {
        await expect(modal.getByLabel('Permission mode')).toHaveCount(0);
      }

      if (extraUi) {
        await modal.getByTestId('legacy-agent-customize-launch').click();
        await expect(modal.getByTestId('legacy-agent-advanced')).toBeVisible();
        await expect(modal.getByText('Extra args')).toBeVisible();
        await modal.getByTestId('legacy-agent-customize-launch').click();
        await expect(modal.getByTestId('legacy-agent-advanced')).toBeHidden();
        await expect(modal.getByTestId('composer-typeahead-menu')).toHaveCount(0);
      }

      await send.click();

      await expect(modal).toBeHidden({ timeout: 30_000 });
      const agentModal = window.locator('[data-testid="agent-terminal-modal"]');
      await expect(agentModal).toBeVisible({ timeout: 15_000 });
      await expect(agentModal.getByTestId('agent-modal-header')).toBeVisible();
      await expect(agentModal.getByTestId('agent-session-view')).toBeVisible();

      if (extraUi) {
        const stateChip = agentModal.locator('[data-testid="agent-modal-state"]');
        await expect(stateChip).toHaveAttribute('data-state', 'working', { timeout: 15_000 });
        await expect(agentModal.getByTestId('thread-secondary-show')).toBeVisible();
        await expect(agentModal.getByTestId('thread-secondary-panel')).toHaveCount(0);
        await agentModal.getByTestId('thread-secondary-show').click();
        await expect(agentModal.getByTestId('thread-secondary-panel')).toBeVisible();
        await expect(agentModal.getByTestId('thread-info-pin')).toBeVisible();
        await expect(agentModal.getByRole('button', { name: 'Delete' })).toBeVisible();
        await events.waitForEvent(
          (e) =>
            e.channel === 'terminals:onAgentStatus' &&
            JSON.stringify(e.args).includes('working'),
          15_000
        );
        await agentModal.getByLabel('Close').click();
        await window.getByLabel('List view').click();
        await expect(window.locator('.app-shell')).toHaveClass(/scoped-no-list/);
        await expect(window.locator('.agents-list-pane')).toHaveCount(0);
        await expect(window.locator('.agent-monitor-list')).toBeVisible();
      }
    } finally {
      await cleanupLaunch(window, projectId, projectDir);
      agent.cleanup();
    }
  });
}

const PLAN_FAMILIES = CLI_FAMILIES.filter((row) =>
  row.family === 'claude' || row.family === 'cursor' || row.family === 'codex'
);

for (const row of PLAN_FAMILIES) {
  test(`launching a ${row.family} CLI Agent in Plan opens its terminal`, {
    timeout: 60_000
  }, async ({ app }) => {
    const { window } = app;
    await stubNativeDialogs(app.electron, [0]);
    const agent = makeFakeGenericHoldBinary();
    const projectDir = mkdtempSync(join(tmpdir(), `zcc-launch-ui-plan-${row.family}-`));
    const projectName = basename(projectDir);
    let projectId: string | null = null;

    try {
      const patch: Record<string, unknown> = {
        [row.binaryKey]: agent.path,
        defaultHarness: row.family
      };
      if (row.enableKey) patch[row.enableKey] = true;
      await window.evaluate(async (cfg) => {
        await window.cc.config.set(cfg);
      }, patch);
      await probeHarness(window, row.family, /^2026\.09\.02$/);

      projectId = await window.evaluate(async (path) => {
        const res = await window.cc.projects.add(path);
        const proj = (res && 'ok' in res ? (res as { value: { id: string } }).value : res) as {
          id: string;
        };
        return proj.id;
      }, projectDir);
      expect(projectId).toBeTruthy();

      await window.locator('[data-testid="nav-agents"]').click();
      await window.locator('[data-testid="agents-board-new-thread"]').first().click();
      const modal = window.locator('[data-testid="launch-modal"]');
      await expect(modal).toBeVisible();
      await modal.getByRole('button', { name: 'CLI Agent' }).click();

      const instruction = modal.getByTestId('legacy-agent-command-input');
      await instruction.click();
      await instruction.fill('draft a plan for the smoke check');
      await expect(instruction).toContainText('draft a plan for the smoke check');

      const targetProject = modal.getByRole('button', { name: 'Project' });
      await targetProject.click();
      await window
        .getByRole('listbox', { name: 'Project' })
        .getByRole('option', { name: projectName, exact: true })
        .click();
      await expect(targetProject).toContainText(projectName);

      await selectHarness(window, modal, row.providerId);
      await expect(modal.getByTestId('composer-mode-picker-trigger')).toContainText('Agent');
      await selectWorkMode(window, modal, 'plan');
      await expect(modal.getByTestId('composer-mode-picker-trigger')).toContainText('Plan');
      await expect(modal.getByTestId('composer-mode-picker-trigger')).toContainText('Plan');

      const send = modal.getByTestId('legacy-agent-command-send');
      await expect(send).toBeEnabled({ timeout: 15_000 });
      await send.click();

      await expect(modal).toBeHidden({ timeout: 30_000 });
      const agentModal = window.locator('[data-testid="agent-terminal-modal"]');
      await expect(agentModal).toBeVisible({ timeout: 15_000 });
      await expect(agentModal.getByTestId('agent-modal-header')).toBeVisible();
      await expect(agentModal.getByTestId('agent-session-view')).toBeVisible();
    } finally {
      await cleanupLaunch(window, projectId, projectDir);
      agent.cleanup();
    }
  });
}
