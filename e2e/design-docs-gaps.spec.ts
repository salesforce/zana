import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { createSqliteDatabase } from '../packages/db/src/sqlite.js';
import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });

// The comment keeps odd spacing and a newline on purpose: it must survive byte-for-byte.
const AI_COMMENT = '<!-- AI Instructions: keep   this\n  exact -->';

interface Doc { id: string; slug: string; projectId: string | null }

async function installDesignDocs(win: Page): Promise<void> {
  await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
  const install = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }));
  expect(install).toMatchObject({ ok: true });
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((p) => p.id === 'design-docs')?.status
  ), { timeout: 30_000 }).toBe('running');
}

/** Same IPC path the renderer uses. */
function rpc<T>(win: Page, method: string, input?: unknown): Promise<T> {
  return win.evaluate(
    ({ method, input }) => window.cc.pluginApps.callRpc('design-docs', method, input),
    { method, input }
  ) as Promise<T>;
}

async function rpcError(win: Page, method: string, input: unknown): Promise<string> {
  return win.evaluate(async ({ method, input }) => {
    try {
      await window.cc.pluginApps.callRpc('design-docs', method, input);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }, { method, input });
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

test('adds a template to an existing doc and keeps AI comments', async ({ app }) => {
  test.setTimeout(120_000);
  const win = app.window;
  await installDesignDocs(win);

  const tpl = await rpc<{ id: string }>(win, 'templateNew', {
    label: 'Gap Kit',
    entryPath: 'kit/a.md',
    files: [{ path: 'kit/a.md', content: `${AI_COMMENT}\n# {{title}}\n` }]
  });
  const key = (await rpc<Array<{ key: string; docId: string }>>(win, 'templates')).find((t) => t.docId === tpl.id)!.key;

  // templateRead returns the template untouched, comment included.
  const read = await rpc<{ files: Array<{ path: string; content: string }> }>(win, 'templateRead', { key });
  expect(read.files.find((f) => f.path === 'kit/a.md')!.content).toBe(`${AI_COMMENT}\n# {{title}}\n`);

  const doc = await rpc<Doc>(win, 'create', { title: 'Template target', template: 'blank' });
  const added = await rpc<{ added: string[] }>(win, 'addFromTemplate', { docId: doc.id, templateKey: key });
  expect(added.added).toEqual(['kit/a.md']);
  const file = await rpc<{ content: string }>(win, 'readFile', { doc: doc.id, path: 'kit/a.md' });
  expect(file.content).toBe(`${AI_COMMENT}\n# Template target\n`);

  // Never overwrites: a second add of the same template conflicts.
  expect(await rpcError(win, 'addFromTemplate', { docId: doc.id, templateKey: key })).toMatch(/already exists/);
});

test('creates and moves a doc to a named project; rejects an unknown project', async ({ app, home }) => {
  test.setTimeout(120_000);
  const win = app.window;
  await installDesignDocs(win);
  const projectId = await addProject(win, home, 'dd-gaps-project');
  const otherId = await addProject(win, home, 'dd-gaps-other');

  const created = await rpc<Doc>(win, 'create', { title: 'Named project doc', template: 'blank', projectId });
  expect(created.projectId).toBe(projectId);

  const moved = await rpc<{ projectId: string | null }>(win, 'update', { doc: created.id, projectId: otherId });
  expect(moved.projectId).toBe(otherId);
  expect((await rpc<Doc>(win, 'get', { doc: created.id })).projectId).toBe(otherId);

  // Main authorizes: an id that is not a registered project is rejected for create and move.
  const bogus = 'no-such-project-id';
  expect(await rpcError(win, 'create', { title: 'Bad project doc', template: 'blank', projectId: bogus })).toMatch(/unknown project/);
  expect(await rpcError(win, 'update', { doc: created.id, projectId: bogus })).toMatch(/unknown project/);
  expect((await rpc<Doc>(win, 'get', { doc: created.id })).projectId).toBe(otherId);
});

test('shows the stored name for a removed project and maps a peer project on confirmation', async ({ app, home }) => {
  test.setTimeout(150_000);
  const win = app.window;
  await installDesignDocs(win);

  // Removed project: its last stored name replaces "Unknown project".
  const goneId = await addProject(win, home, 'dd-gaps-gone');
  await rpc(win, 'projects'); // registers the name in the local ref table
  const goneDoc = await rpc<Doc>(win, 'create', { title: 'Orphaned doc', template: 'blank', projectId: goneId });
  await win.evaluate((id) => window.cc.projects.remove(id), goneId);
  await expect.poll(async () =>
    (await rpc<Array<{ id: string; label: string }>>(win, 'removedProjects')).find((p) => p.id === goneId)?.label,
  { timeout: 30_000 }).toBe('dd-gaps-gone (project removed)');
  expect((await rpc<Doc>(win, 'get', { doc: goneDoc.id })).projectId).toBe(goneId);

  // Peer doc whose foreign project id is unknown here. Seeded in this fixture's own isolated plugin DB,
  // the same way the peer-sync spec seeds received state; no real user data is touched.
  const targetId = await addProject(win, home, 'dd-gaps-target');
  const foreign = 'peer-project-e2e';
  const peerDoc = await rpc<Doc>(win, 'create', { title: 'Peer received doc', template: 'blank' });
  const db = createSqliteDatabase(join(home, '.zcc', 'plugins', 'design-docs', 'data.db'), { fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    db.prepare(`INSERT INTO sync_doc_references (doc_id, project_json, threads_json) VALUES (?, ?, '[]')
      ON CONFLICT (doc_id) DO UPDATE SET project_json = excluded.project_json`).run(peerDoc.id, JSON.stringify(foreign));
  } finally {
    db.close();
  }
  await expect.poll(async () =>
    (await rpc<Array<{ foreignProjectId: string }>>(win, 'listUnassignedProjects')).map((p) => p.foreignProjectId),
  { timeout: 30_000 }).toContain(foreign);

  await win.getByRole('button', { name: /^Design Docs/ }).click();
  const section = win.getByRole('region', { name: 'Unassigned from peers' });
  await expect(section).toBeVisible({ timeout: 30_000 });
  await expect(section).toContainText('Peer received doc');
  await section.getByRole('button', { name: /Map to a Project/ }).click();

  const dialog = win.getByRole('dialog', { name: 'Map peer projects' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(`Local Project for ${foreign}`).selectOption(targetId);
  // Picking alone applies nothing: only Confirm maps.
  expect((await rpc<unknown[]>(win, 'listUnassignedProjects')).length).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect.poll(async () =>
    (await rpc<Array<{ foreignProjectId: string }>>(win, 'listUnassignedProjects')).map((p) => p.foreignProjectId),
  { timeout: 30_000 }).not.toContain(foreign);
  await expect(win.getByText('Project mapped. Its docs now show under that Project.')).toBeVisible();
});

test('opens a cross-doc link', async ({ app, home }) => {
  test.setTimeout(120_000);
  const win = app.window;
  await installDesignDocs(win);
  const projectId = await addProject(win, home, 'dd-gaps-links');

  const target = await rpc<Doc>(win, 'create', { title: 'Link target doc', template: 'blank', projectId });
  const source = await rpc<Doc>(win, 'create', { title: 'Link source doc', template: 'blank', projectId });
  await rpc(win, 'writeFile', { doc: target.id, path: 'api.md', content: '# Target API page\n', baseRevision: 0, baseFileId: null });
  const readme = await rpc<{ revision: number; fileId: string }>(win, 'readFile', { doc: source.id, path: 'README.md' });
  await rpc(win, 'writeFile', {
    doc: source.id, path: 'README.md', content: `[Go to API](doc://${target.slug}/api.md)\n`,
    baseRevision: readme.revision, baseFileId: readme.fileId
  });

  // The server resolves and authorizes; same-project target resolves, unknown ref does not.
  expect(await rpc(win, 'resolveCrossDocLink', { fromDoc: source.id, href: `doc://${target.slug}/api.md` }))
    .toEqual({ docId: target.id, path: 'api.md' });
  expect(await rpc(win, 'resolveCrossDocLink', { fromDoc: source.id, href: 'doc://no-such-doc/a.md' }))
    .toEqual({ error: 'missing-doc' });

  await win.getByRole('button', { name: /^Design Docs/ }).click();
  await win.getByText('Link source doc').first().click();
  await expect.poll(() => win.url()).toContain(source.id);
  await win.getByRole('link', { name: 'Go to API' }).click();
  await expect.poll(() => win.url(), { timeout: 30_000 }).toContain(target.id);
  await expect(win.getByText('Target API page').first()).toBeVisible({ timeout: 30_000 });
});

test('opens a relative link to a nested file in the same doc', async ({ app, home }) => {
  test.setTimeout(120_000);
  const win = app.window;
  await installDesignDocs(win);
  const projectId = await addProject(win, home, 'dd-gaps-relative');
  const doc = await rpc<Doc>(win, 'create', { title: 'Relative link doc', template: 'technical', projectId });
  const readme = await rpc<{ revision: number; fileId: string }>(win, 'readFile', { doc: doc.id, path: 'README.md' });
  await rpc(win, 'writeFile', {
    doc: doc.id, path: 'README.md', content: 'Context text.\n\n[x](diagrams/architecture.mmd)\n\n## Goals\n',
    baseRevision: readme.revision, baseFileId: readme.fileId
  });

  await win.getByRole('button', { name: /^Design Docs/ }).click();
  await win.getByText('Relative link doc').first().click();
  await expect.poll(() => win.url()).toContain(doc.id);
  await win.getByRole('link', { name: 'x', exact: true }).click();
  await expect.poll(() => decodeURIComponent(win.url()), { timeout: 30_000 }).toContain('architecture.mmd');
});

test('scrolls to a heading anchor, and adds a template twice with numbered names', async ({ app, home }) => {
  test.setTimeout(150_000);
  const win = app.window;
  await installDesignDocs(win);
  const projectId = await addProject(win, home, 'dd-gaps-anchor');
  const doc = await rpc<Doc>(win, 'create', { title: 'Anchor doc', template: 'blank', projectId });
  const readme = await rpc<{ revision: number; fileId: string }>(win, 'readFile', { doc: doc.id, path: 'README.md' });
  const filler = Array.from({ length: 80 }, (_, i) => `Filler paragraph ${i}.`).join('\n\n');
  await rpc(win, 'writeFile', {
    doc: doc.id, path: 'README.md', content: `[go](#final-notes)\n\n${filler}\n\n## Final Notes\n\nEnd.\n`,
    baseRevision: readme.revision, baseFileId: readme.fileId
  });

  await win.getByRole('button', { name: /^Design Docs/ }).click();
  await win.getByText('Anchor doc').first().click();
  await expect.poll(() => win.url()).toContain(doc.id);
  await expect(win.getByRole('heading', { name: 'Final Notes' })).not.toBeInViewport();
  await win.getByRole('link', { name: 'go', exact: true }).click();
  await expect(win.getByRole('heading', { name: 'Final Notes' })).toBeInViewport({ timeout: 15_000 });

  for (const expected of ['README-2.md', 'README-3.md']) {
    await win.getByRole('button', { name: 'Add to doc' }).click();
    await win.getByRole('menuitem', { name: /^From template/ }).click();
    await win.getByRole('combobox').selectOption({ label: 'Technical design' });
    await win.getByRole('dialog').getByRole('button', { name: 'Add files' }).click();
    await expect(win.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
    await expect(win.getByRole('button', { name: expected })).toBeVisible({ timeout: 15_000 });
  }
});
