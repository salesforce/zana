import type { Dialog, Page } from '@playwright/test';
import { expect, test } from './fixtures/app.js';

type EditorFixture = {
  kind: 'persona' | 'squad';
  navTestId: string;
  fieldId: string;
  userId: string;
  cleanId: string;
  saveId: string;
  builtinId: string;
  builtinName: string;
  userName: string;
  cleanName: string;
  saveName: string;
  overrideName: string;
  list: (page: Page) => Promise<Array<{ id: string; name: string; source?: unknown }>>;
  seed: (page: Page, input: { id: string; name: string }) => Promise<void>;
  open: (page: Page, name: string) => Promise<void>;
};

const editors: EditorFixture[] = [
  {
    kind: 'persona',
    navTestId: 'settings-nav-personas',
    fieldId: 'persona-name',
    userId: 'e2e-dirty-persona-delete',
    cleanId: 'e2e-dirty-persona-clean',
    saveId: 'e2e-dirty-persona-save',
    builtinId: 'builtin:orchestrator',
    builtinName: 'Orchestrator',
    userName: 'E2E Dirty Persona Delete',
    cleanName: 'E2E Dirty Persona Clean',
    saveName: 'E2E Dirty Persona Save',
    overrideName: 'E2E Dirty Persona Override',
    list: (page) => page.evaluate(() => window.cc.personas.list()),
    seed: async (page, input) => {
      const result = await page.evaluate((value) => window.cc.personas.save({ ...value, baseProfile: 'shell' }), input);
      if (!result.ok) throw new Error(result.message ?? `Could not save ${input.id}`);
    },
    open: async (page, name) => {
      await page.locator('.skills-row-open').filter({ hasText: name }).click();
    }
  },
  {
    kind: 'squad',
    navTestId: 'settings-nav-squads',
    fieldId: 'team-name',
    userId: 'e2e-dirty-squad-delete',
    cleanId: 'e2e-dirty-squad-clean',
    saveId: 'e2e-dirty-squad-save',
    builtinId: 'builtin:review-squad',
    builtinName: 'Review Squad',
    userName: 'E2E Dirty Squad Delete',
    cleanName: 'E2E Dirty Squad Clean',
    saveName: 'E2E Dirty Squad Save',
    overrideName: 'E2E Dirty Squad Override',
    list: (page) => page.evaluate(() => window.cc.teams.list()),
    seed: async (page, input) => {
      const result = await page.evaluate((value) => window.cc.teams.save({
        ...value,
        orchestratorPersonaId: 'builtin:orchestrator',
        slots: [{ personaId: 'builtin:orchestrator', quantity: 1 }]
      }), input);
      if (!result.ok) throw new Error(result.message ?? `Could not save ${input.id}`);
    },
    open: async (page, name) => {
      await page.getByRole('button', { name: `Open ${name}`, exact: true }).click();
    }
  }
];

async function confirm(page: Page, action: () => Promise<void>, accept: boolean): Promise<Pick<Dialog, 'type' | 'message'>> {
  let received: Pick<Dialog, 'type' | 'message'> | undefined;
  page.once('dialog', (dialog) => {
    received = dialog;
    void (accept ? dialog.accept() : dialog.dismiss());
  });
  await action();
  await expect.poll(() => received?.type()).toBe('confirm');
  return received!;
}

async function expectNoDialog(page: Page, action: () => Promise<void>): Promise<void> {
  let count = 0;
  const dismissUnexpected = (dialog: Dialog) => {
    count += 1;
    void dialog.dismiss();
  };
  page.on('dialog', dismissUnexpected);
  try {
    await action();
    expect(count).toBe(0);
  } finally {
    page.off('dialog', dismissUnexpected);
  }
}

for (const editor of editors) {
  test(`${editor.kind} editor confirms dirty changes before cancel, delete/reset, and allows clean cancel/save`, async ({ app }) => {
    const { window } = app;
    await editor.seed(window, { id: editor.userId, name: editor.userName });
    await editor.seed(window, { id: editor.cleanId, name: editor.cleanName });
    await editor.seed(window, { id: editor.saveId, name: editor.saveName });
    // Saving a built-in id creates its personal override, which Reset must remove.
    await editor.seed(window, { id: editor.builtinId, name: editor.overrideName });

    await window.getByRole('link', { name: 'Settings', exact: true }).click();
    await window.getByTestId(editor.navTestId).click();
    const field = () => window.locator(`#${editor.fieldId}`);

    // Rejecting a dirty Cancel preserves form state and never writes it.
    await editor.open(window, editor.userName);
    await field().fill(`${editor.userName} changed`);
    const cancelDialog = await confirm(window, () => window.getByRole('button', { name: 'Cancel', exact: true }).click(), false);
    expect(cancelDialog.message()).toMatch(/unsaved|discard/i);
    await expect(field()).toHaveValue(`${editor.userName} changed`);
    await expect.poll(async () => (await editor.list(window)).find((row) => row.id === editor.userId)?.name).toBe(editor.userName);

    // Rejecting Delete proves deletion is not dispatched before confirmation.
    const deleteDialog = await confirm(window, () => window.getByRole('button', { name: 'Delete', exact: true }).click(), false);
    expect(deleteDialog.message()).toMatch(/unsaved|discard/i);
    await expect(field()).toHaveValue(`${editor.userName} changed`);
    await expect.poll(async () => (await editor.list(window)).find((row) => row.id === editor.userId)?.name).toBe(editor.userName);

    await confirm(window, () => window.getByRole('button', { name: 'Delete', exact: true }).click(), true);
    await expect.poll(async () => (await editor.list(window)).some((row) => row.id === editor.userId)).toBe(false);

    // Rejecting Reset preserves both dirty form state and the user override.
    await editor.open(window, editor.overrideName);
    await field().fill(`${editor.overrideName} changed`);
    const resetDialog = await confirm(window, () => window.getByRole('button', { name: 'Reset', exact: true }).click(), false);
    expect(resetDialog.message()).toMatch(/unsaved|discard/i);
    await expect(field()).toHaveValue(`${editor.overrideName} changed`);
    await expect.poll(async () => (await editor.list(window)).find((row) => row.id === editor.builtinId)?.name).toBe(editor.overrideName);

    await confirm(window, () => window.getByRole('button', { name: 'Reset', exact: true }).click(), true);
    await expect.poll(async () => (await editor.list(window)).find((row) => row.id === editor.builtinId)?.name).toBe(editor.builtinName);

    // Focused keyboard input makes the draft dirty; accepting Cancel discards it.
    await editor.open(window, editor.cleanName);
    await field().click();
    await field().press('End');
    await field().pressSequentially(' changed');
    const acceptedCancelDialog = await confirm(window, () => window.getByRole('button', { name: 'Cancel', exact: true }).click(), true);
    expect(acceptedCancelDialog.message()).toMatch(/unsaved|discard/i);
    await expect(window.getByRole('dialog', { name: editor.cleanName })).toHaveCount(0);

    // Restoring original value makes the editor clean: Cancel closes without a native dialog.
    await editor.open(window, editor.cleanName);
    await field().fill(`${editor.cleanName} changed`);
    await field().fill(editor.cleanName);
    await expectNoDialog(window, () => window.getByRole('button', { name: 'Cancel', exact: true }).click());
    await expect(window.getByRole('dialog', { name: editor.cleanName })).toHaveCount(0);

    // Saving dirty work persists through the product API without a confirmation.
    await editor.open(window, editor.saveName);
    await field().fill(`${editor.saveName} changed`);
    await expectNoDialog(window, () => window.getByRole('button', { name: 'Save', exact: true }).click());
    await expect.poll(async () => (await editor.list(window)).find((row) => row.id === editor.saveId)?.name).toBe(`${editor.saveName} changed`);
  });
}
