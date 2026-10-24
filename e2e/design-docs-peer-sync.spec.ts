import { join } from 'node:path';
import { createSqliteDatabase } from '../packages/db/src/sqlite.js';
import type { PluginDatabase } from '../packages/plugin-sdk/src/server.js';
import { DesignDocSyncStore } from '../plugins/design-docs/src/server/sync-store.js';
import { createScopeHash } from '../plugins/design-docs/src/server/peer-protocol.js';
import { canonicalPeerHash } from '../plugins/design-docs/src/shared/peer-contract.js';
import type { DesignDocDetail, DesignDocFile } from '../plugins/design-docs/src/shared/contract.js';
import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });

test('paired Design Docs rejects stale approval and preserves dirty buffer across file replacement', async ({ app }) => {
  const { window: win, home } = app;
  const installed = await win.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }));
  expect(installed).toMatchObject({ ok: true });
  const trust = win.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => win.evaluate(async () =>
    (await window.cc.pluginApps.list()).find((plugin) => plugin.id === 'design-docs')?.status
  ), { timeout: 30_000 }).toMatch(/running|needs-configuration/);

  // Seed only this fixture's paired state; no network grant or real user config is modified.
  const db = createSqliteDatabase(join(home, '.zcc', 'plugins', 'design-docs', 'data.db'), { fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    const database: PluginDatabase = {
      prepare: (sql) => db.prepare(sql),
      runScript: (sql) => db.exec(sql),
      migrate: (statements) => { for (const sql of statements) db.exec(sql); },
      transaction: (fn) => db.transaction(fn)()
    };
    const sync = new DesignDocSyncStore(database);
    const local = sync.initializeLocal();
    sync.setGroup(local.repoId, 'e2e-group', [
      { replicaId: local.replicaId, machineId: 'e2e-local', sponsorReplicaId: null, joinedAt: 1 },
      { replicaId: 'e2e-peer', machineId: 'e2e-remote', sponsorReplicaId: null, joinedAt: 1 }
    ]);
    const rpc = <T,>(method: string, input: unknown): Promise<T> => win.evaluate(
      ({ method, input }) => window.cc.pluginApps.callRpc('design-docs', method, input), { method, input }
    ) as Promise<T>;
    const doc = await rpc<DesignDocDetail>('create', { title: 'Electron CAS consent', template: 'blank' });
    expect(doc.head).toEqual(expect.any(String));
    await rpc('writeFile', { doc: doc.id, path: 'note.md', content: 'Original note', baseRevision: 0, baseFileId: null });
    await win.getByRole('button', { name: 'Design Docs', exact: true }).click();
    await win.getByRole('button', { name: /Electron CAS consent/ }).click();
    const panel = win.locator('.dd-doc');
    await panel.getByTitle('Change status').click();
    const entry = await rpc<DesignDocFile>('readFile', { doc: doc.id, path: 'README.md' });
    await rpc('writeFile', { doc: doc.id, path: entry.path, content: 'Unreviewed replacement', baseRevision: entry.revision, baseFileId: entry.fileId });
    await expect(panel).toContainText('Unreviewed replacement');
    await win.getByRole('menuitem', { name: 'Approved', exact: true }).click();
    await expect(win.getByText(/Could not update the doc:.*head changed/)).toBeVisible();
    expect((await rpc<DesignDocDetail>('get', { doc: doc.id })).status).toBe('draft');
    expect(db.prepare('SELECT frozen_head FROM sync_intents WHERE doc_id = ?').all(doc.id)).toHaveLength(0);
    await panel.getByTitle('Change status').click();
    await win.getByRole('menuitem', { name: 'Approved', exact: true }).click();
    await expect(panel.getByTitle('Change status')).toHaveText('Approved');
    const approved = await rpc<DesignDocDetail>('get', { doc: doc.id });
    expect(db.prepare('SELECT frozen_head FROM sync_intents WHERE doc_id = ?').all(doc.id)).toEqual([{ frozen_head: approved.head }]);

    await win.getByRole('navigation', { name: 'Files' }).getByRole('button', { name: 'note.md', exact: true }).click();
    await panel.getByRole('group', { name: 'View mode' }).getByRole('button', { name: 'Edit', exact: true }).click();
    const editor = panel.getByRole('textbox', { name: 'Edit note.md' });
    await editor.fill('Unsaved Electron buffer');
    const original = await rpc<DesignDocFile>('readFile', { doc: doc.id, path: 'note.md' });
    await rpc('deleteFile', { doc: doc.id, path: original.path, baseRevision: original.revision, baseFileId: original.fileId });
    await expect(panel.getByRole('alert')).toContainText('was deleted or renamed');
    await expect(editor).toHaveValue('Unsaved Electron buffer');
    await rpc('writeFile', { doc: doc.id, path: 'note.md', content: 'Recreated peer note', baseRevision: 0, baseFileId: null });
    const replacement = await rpc<DesignDocFile>('readFile', { doc: doc.id, path: 'note.md' });
    expect(replacement.fileId).not.toBe(original.fileId);
    await expect(panel.getByRole('button', { name: 'Overwrite with mine' })).toBeEnabled();
    await expect(panel.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    await expect(editor).toHaveValue('Unsaved Electron buffer');
    expect(replacement.content).toBe('Recreated peer note');
    await panel.getByRole('button', { name: 'Overwrite with mine' }).click();
    await expect(panel).toContainText('Saved · rev');
    const saved = await rpc<DesignDocFile>('readFile', { doc: doc.id, path: 'note.md' });
    expect(saved).toMatchObject({ fileId: replacement.fileId, content: 'Unsaved Electron buffer' });
    await expect(editor).toHaveValue(saved.content);

    // Retained fork enters through the real plugin RPC/UI seam; pair auth is covered separately.
    const beforeFork = await rpc<DesignDocDetail>('get', { doc: doc.id });
    const remote = structuredClone(sync.version(local.repoId, beforeFork.head!)!);
    remote.operation = { ...remote.operation, id: 'e2e-remote-head', replicaId: 'e2e-peer', sequence: 1, parents: [beforeFork.head!] };
    const remoteFile = remote.closure.files.find((file) => file.path === 'note.md')!;
    remoteFile.content = 'Peer conflict bytes'; remoteFile.size = Buffer.byteLength(remoteFile.content);
    remote.operation.payloadHash = canonicalPeerHash(remote.closure);
    await rpc('writeFile', { doc: doc.id, path: 'note.md', content: 'Local conflict bytes', baseRevision: saved.revision, baseFileId: saved.fileId });
    const ancestors = new Map<string, NonNullable<ReturnType<DesignDocSyncStore['version']>>>();
    const visit = (head: string) => {
      if (ancestors.has(head)) return;
      const version = sync.version(local.repoId, head)!;
      version.operation.parents.forEach(visit);
      ancestors.set(head, version);
    };
    visit(beforeFork.head!);
    const body = { protocolVersion: 2, repoId: local.repoId, senderReplicaId: 'e2e-peer', recipientReplicaId: local.replicaId,
      groupId: 'e2e-group', rosterEpoch: 1, grantEpoch: 1, sessionId: 'e2e-fork',
      versions: [...ancestors.values(), remote], heads: { [doc.id]: remote.operation.id } };
    expect(sync.apply({ ...body, scopeHash: createScopeHash(body) }).stage).toBe('conflict');
    await expect(editor).toHaveValue('Local conflict bytes');
    await editor.fill('Dirty buffer during resolution');
    await rpc('writeFile', { doc: doc.id, path: 'local-only.md', content: 'Temporary review file', baseRevision: 0, baseFileId: null });
    await panel.getByRole('button', { name: 'Peer conflicts', exact: true }).click();
    const review = win.getByRole('dialog', { name: 'Peer conflicts' });
    await review.getByRole('combobox', { name: 'File', exact: true }).selectOption('local-only.md');
    await review.getByRole('combobox', { name: 'Resolution' }).selectOption('remote');
    await expect(review.getByRole('button', { name: 'Resolve reviewed fork' })).toBeEnabled();
    const temporary = await rpc<DesignDocFile>('readFile', { doc: doc.id, path: 'local-only.md' });
    await rpc('deleteFile', { doc: doc.id, path: temporary.path, baseRevision: temporary.revision, baseFileId: temporary.fileId });
    await review.getByRole('button', { name: 'Resolve reviewed fork' }).click();
    await expect(review.getByRole('alert')).toContainText('head changed');
    await review.getByRole('button', { name: 'Review again' }).click();
    await expect(review.getByRole('combobox', { name: 'File', exact: true })).toHaveValue('README.md');
    await review.getByRole('combobox', { name: 'File', exact: true }).selectOption('note.md');
    await review.getByText('Peer', { exact: true }).click();
    await expect(review).toContainText('Peer conflict bytes');
    await review.getByRole('combobox', { name: 'Resolution' }).selectOption('remote');
    await expect(review.getByRole('button', { name: 'Resolve reviewed fork' })).toBeEnabled();
    await review.getByRole('button', { name: 'Resolve reviewed fork' }).click();
    await expect(review).toContainText('No unresolved peer forks.');
    await expect(editor).toHaveValue('Dirty buffer during resolution');
    expect((await rpc<DesignDocFile>('readFile', { doc: doc.id, path: 'note.md' })).content).toBe('Peer conflict bytes');
    const resolved = await rpc<DesignDocDetail>('get', { doc: doc.id });
    expect(sync.version(local.repoId, resolved.head!)!.operation).toMatchObject({ origin: 'maintenance', parents: expect.arrayContaining([remote.operation.id]) });
    expect(db.prepare('SELECT frozen_head FROM sync_intents WHERE frozen_head = ?').all(resolved.head)).toEqual([]);
  } finally {
    db.close();
  }
});
