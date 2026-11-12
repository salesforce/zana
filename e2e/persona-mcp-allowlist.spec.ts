import type { Page } from '@playwright/test';
import { test, expect } from './fixtures/app.js';
import { MISSING_SERVER, USER_ALLOWED, USER_BLOCKED, USER_CREDENTIALED, seedMcpInventory } from './fixtures/mcp-allowlist.js';

// Persona editor "Restrict MCP servers" (and the shared "Restrict skills") at the real Electron
// boundary: absent / [] / list save semantics, catalogue typeahead, advisory-only warnings,
// the always-allowed chip and the legacy-list notice.

test.use({
  initialConfig: async ({}, use) => {
    await use({ sponsorPromptDismissed: true });
  },
});

async function openPersonas(window: Page) {
  await window.getByRole('link', { name: 'Settings' }).click();
  await window.locator('.settings-section-item').filter({ hasText: 'Personas' }).click();
}

async function stored(page: Page, name: string) {
  return page.evaluate(async (personaName) => {
    const p = (await window.cc.personas.list()).find((x) => x.name === personaName);
    return p ? { found: true, mcpServers: p.mcpServers ?? null, skills: p.skills ?? null } : { found: false, mcpServers: null, skills: null };
  }, name);
}

async function newPersona(window: Page, name: string) {
  await openPersonas(window);
  await window.getByRole('button', { name: 'New persona' }).click();
  await window.locator('#persona-name').fill(name);
}

const save = (window: Page) => window.getByRole('button', { name: 'Save', exact: true }).click();

test('save semantics: absent, empty list and named list are different stored states', async ({ app }) => {
  const { window } = app;
  seedMcpInventory(app.home);
  const name = 'Tri State';
  await newPersona(window, name);

  // Unrestricted: nothing stored, effective copy says every server loads.
  await expect(window.getByTestId('persona-skills-field')).toBeVisible();
  await expect(window.getByTestId('persona-mcp-field')).toBeVisible();
  await expect(window.getByTestId('persona-mcp-effective')).toContainText('Unrestricted');
  await save(window);
  await expect.poll(() => stored(window, name)).toMatchObject({ found: true, mcpServers: null });

  // Restricted with no entries: [] and the fixed zcc-inbox chip.
  await window.locator('.skills-row-open').filter({ hasText: name }).click();
  await window.getByLabel('Restrict MCP servers').check();
  await expect(window.getByTestId('persona-mcp-field').getByTestId('allowlist-fixed-chip')).toHaveText(/zcc-inbox/);
  await expect(window.getByTestId('persona-mcp-field').getByTestId('allowlist-chip')).toHaveCount(0);
  await expect(window.getByTestId('persona-mcp-field').getByTestId('allowlist-hint')).toContainText('no servers load except zcc-inbox');
  await save(window);
  await expect.poll(() => stored(window, name)).toMatchObject({ mcpServers: [] });

  // Restricted with an entry: exactly that list (zcc-inbox is implicit, never stored).
  await window.locator('.skills-row-open').filter({ hasText: name }).click();
  await expect(window.getByLabel('Restrict MCP servers')).toBeChecked();
  const input = window.getByRole('combobox', { name: 'Allowed MCP servers' });
  await input.fill(USER_ALLOWED);
  await input.press('Enter');
  await expect(window.getByTestId('persona-mcp-field').getByTestId('allowlist-chip')).toHaveCount(1);
  await save(window);
  await expect.poll(() => stored(window, name)).toMatchObject({ mcpServers: [USER_ALLOWED] });

  // Uncheck: back to absent, not [].
  await window.locator('.skills-row-open').filter({ hasText: name }).click();
  await window.getByLabel('Restrict MCP servers').uncheck();
  await save(window);
  await expect.poll(() => stored(window, name)).toMatchObject({ mcpServers: null });
});

test('skills field is independent of the MCP field and stores its own tri-state', async ({ app }) => {
  const { window } = app;
  const name = 'Skills Only';
  await newPersona(window, name);
  await window.getByLabel('Restrict skills').check();
  await expect(window.getByTestId('persona-skills-field').getByTestId('allowlist-fixed-chip')).not.toHaveCount(0);
  await save(window);
  await expect.poll(() => stored(window, name)).toMatchObject({ skills: [], mcpServers: null });
});

test('catalogue typeahead suggests host servers and a missing name warns without blocking save', async ({ app }) => {
  const { window } = app;
  seedMcpInventory(app.home);
  const name = 'Typeahead';
  await newPersona(window, name);
  await window.getByLabel('Restrict MCP servers').check();
  const field = window.getByTestId('persona-mcp-field');
  const input = window.getByRole('combobox', { name: 'Allowed MCP servers' });

  await input.fill('mcp-');
  const listbox = field.getByRole('listbox');
  await expect(listbox.getByRole('option', { name: new RegExp(USER_ALLOWED) })).toBeVisible();
  await expect(listbox.getByRole('option', { name: new RegExp(USER_BLOCKED) })).toBeVisible();
  // A credentialed server is listed but flagged as signing in separately (catalogue exposes names, never secrets).
  await expect(listbox.getByRole('option', { name: new RegExp(USER_CREDENTIALED) })).toContainText('signs in separately');
  await listbox.getByRole('option', { name: new RegExp(USER_ALLOWED) }).click();
  await expect(field.getByTestId('allowlist-chip')).toHaveText(new RegExp(USER_ALLOWED));
  await expect(window.getByTestId('persona-mcp-effective')).toContainText('Restricted: 1 of');

  // A name no catalogue knows: advisory only.
  await input.fill(MISSING_SERVER);
  await input.press('Enter');
  const warning = window.getByTestId('persona-mcp-missing-warning');
  await expect(warning).toContainText(MISSING_SERVER);
  await expect(warning).toContainText('You can still save');
  await expect(field.locator('[data-testid="allowlist-chip"][data-state="missing"]')).toHaveCount(1);
  await save(window);
  await expect.poll(() => stored(window, name)).toMatchObject({ mcpServers: [USER_ALLOWED, MISSING_SERVER] });
});

test('invalid server name is refused inline and not stored', async ({ app }) => {
  const { window } = app;
  const name = 'Bad Name';
  await newPersona(window, name);
  await window.getByLabel('Restrict MCP servers').check();
  const input = window.getByRole('combobox', { name: 'Allowed MCP servers' });
  await input.fill('bad*glob');
  await input.press('Enter');
  await expect(window.getByTestId('allowlist-error')).toContainText('not a valid server name');
  await expect(window.getByTestId('persona-mcp-field').getByTestId('allowlist-chip')).toHaveCount(0);
});

test('a saved legacy list shows the meaning-change warning until edited', async ({ app }) => {
  const { window } = app;
  seedMcpInventory(app.home);
  const name = 'Legacy List';
  await window.evaluate(async (n) => {
    const r = await window.cc.personas.save({ id: 'e2e-legacy-mcp', name: n, mcpServers: ['mcp-alpha'] } as any);
    if (!r.ok) throw new Error(JSON.stringify(r));
  }, name);
  await openPersonas(window);
  await window.locator('.skills-row-open').filter({ hasText: name }).click();
  const legacy = window.getByTestId('persona-mcp-legacy-warning');
  await expect(legacy).toContainText('only');
  await expect(legacy).toContainText('zcc-inbox');
  // Changing the list clears the notice.
  const input = window.getByRole('combobox', { name: 'Allowed MCP servers' });
  await input.fill(USER_BLOCKED);
  await input.press('Enter');
  await expect(legacy).toHaveCount(0);
});
