import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { createSqliteDatabase } from '../packages/db/src/sqlite.js';
import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });

interface Doc { id: string; slug: string; projectId: string | null }

async function installDesignDocs(win: Page): Promise<void> {
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  const install = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }));
  expect(install).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((p) => p.id === 'design-docs')?.status
  ), { timeout: 30_000 }).toBe('running');
}

function rpc<T>(win: Page, method: string, input?: unknown): Promise<T> {
  return win.evaluate(
    ({ method, input }) => window.cc.pluginApps.callRpc('design-docs', method, input),
    { method, input }
  ) as Promise<T>;
}

async function addProject(win: Page, home: string, folder: string): Promise<string> {
  const path = join(home, folder);
  mkdirSync(path, { recursive: true });
  return win.evaluate(async (p) => {
    const result = await window.cc.projects.add(p);
    if (!result.ok) throw new Error(result.message);
    return result.value.id;
  }, path);
}

test('groups unassigned peer docs per foreign project and maps from the shortcut', async ({ app, home }) => {
  test.setTimeout(180_000);
  const win = app.window;
  await installDesignDocs(win);

  const matchId = await addProject(win, home, 'dd-ug-alpha');
  await rpc(win, 'projects'); // makes sure the plugin tables exist

  // Seed received peer state in this fixture's own isolated plugin DB (same as the gaps spec).
  const seeds: Array<{ title: string; foreign: unknown; name?: string }> = [
    { title: 'Alpha peer doc', foreign: 'far-alpha', name: 'dd-ug-alpha' }, // sender name matches a local Project
    { title: 'Beta peer doc', foreign: 'far-beta', name: 'Sender Beta' },
    { title: 'Gamma title only doc', foreign: 'far-gamma' },
    { title: 'Shared one doc', foreign: 'far-shared-1', name: 'Shared Name' },
    { title: 'Shared two doc', foreign: 'far-shared-2', name: 'Shared Name' },
    { title: 'Odd id doc', foreign: 123 } // non-string foreign id lands in Other
  ];
  const ids: string[] = [];
  for (const seed of seeds) ids.push((await rpc<Doc>(win, 'create', { title: seed.title, template: 'blank' })).id);
  const db = createSqliteDatabase(join(home, '.zcc', 'plugins', 'design-docs', 'data.db'), { fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    seeds.forEach((seed, i) => {
      if (seed.name) {
        db.prepare(`INSERT INTO dd_project_refs (project_id, name, tag, last_seen) VALUES (?, ?, NULL, ?)
          ON CONFLICT (project_id) DO UPDATE SET name = excluded.name`).run(seed.foreign as string, seed.name, Date.now());
      }
      db.prepare(`INSERT INTO sync_doc_references (doc_id, project_json, threads_json) VALUES (?, ?, '[]')
        ON CONFLICT (doc_id) DO UPDATE SET project_json = excluded.project_json`).run(ids[i], JSON.stringify(seed.foreign));
    });
  } finally {
    db.close();
  }
  await expect.poll(async () =>
    (await rpc<Array<{ foreignProjectId: string }>>(win, 'listUnassignedProjects')).length,
  { timeout: 30_000 }).toBeGreaterThanOrEqual(5);

  await win.getByRole('button', { name: /^Design Docs/ }).click();
  const section = win.getByRole('region', { name: 'Unassigned from peers' });
  await expect(section).toBeVisible({ timeout: 30_000 });

  // One subgroup per foreign project; raw foreign ids never reach the DOM.
  const alpha = section.getByRole('group', { name: /^dd-ug-alpha #1, suggested: dd-ug-alpha/ });
  await expect(alpha).toBeVisible({ timeout: 30_000 });
  await expect(section.getByRole('group', { name: /^Sender Beta, from another computer/ })).toBeVisible();
  await expect(section.getByRole('group', { name: /^Gamma title only doc, from another computer/ })).toBeVisible();
  await expect(section.getByRole('group', { name: /^Shared Name/ })).toHaveCount(2);
  await expect(section.getByRole('group', { name: /^Other, / })).toBeVisible();
  expect(await section.innerText()).not.toMatch(/far-(alpha|beta|gamma|shared)/);

  // Other stays closed until opened.
  await expect(section.getByText('Odd id doc')).toHaveCount(0);
  await section.getByRole('group', { name: /^Other, / }).getByRole('button').first().click();
  await expect(section.getByText('Odd id doc')).toBeVisible();

  // A peer label equal to a local Project name gets a numeric suffix so it is not mistaken for it.
  // Map shortcut opens the mapping dialog focused on that group, then maps it.
  // The shortcut is revealed on hover or focus, so hover the heading first like a user would.
  await alpha.locator('.dd-list-subhead').hover();
  await alpha.getByRole('button', { name: /^Map dd-ug-alpha #1 docs to dd-ug-alpha/ }).click();
  const dialog = win.getByRole('dialog', { name: 'Map projects from other computers' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Your Project for dd-ug-alpha').selectOption(matchId);
  await dialog.getByRole('button', { name: 'Map 1 doc to dd-ug-alpha', exact: true }).click();
  await expect.poll(async () =>
    (await rpc<Array<{ foreignProjectId: string }>>(win, 'listUnassignedProjects')).map((p) => p.foreignProjectId),
  { timeout: 30_000 }).not.toContain('far-alpha');
  await expect(win.getByText('Project mapped. Its docs now show under that Project.')).toBeVisible();
  await win.keyboard.press('Escape').catch(() => undefined);
  await expect(section.getByRole('group', { name: /^dd-ug-alpha #1, suggested/ })).toHaveCount(0, { timeout: 30_000 });
  await expect(section.getByRole('group', { name: /^Sender Beta/ })).toBeVisible();
});
