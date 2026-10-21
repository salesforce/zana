import { join } from 'node:path';
import { createSqliteDatabase } from '../packages/db/src/sqlite.js';
import type { PluginDatabase } from '../packages/plugin-sdk/src/server.js';
import { DesignDocPeerGroup } from '../plugins/design-docs/src/server/peer-group.js';
import { appendSeat, createRoster } from '../plugins/design-docs/src/server/peer-slots.js';
import { canonicalJson } from '../plugins/design-docs/src/shared/peer-contract.js';
import { test, expect } from './fixtures/app.js';

test.use({ e2e: true, initialConfig: { sponsorPromptDismissed: true } });

test('Design Docs peer setup exposes lifecycle, enrolled peers and refuses fabricated browser roster', async ({ app }) => {
  const { window, home } = app;
  const existing = await window.evaluate(async () => (await window.cc.pluginApps.list()).some((plugin) => plugin.id === 'design-docs'));
  if (!existing) {
    const installed = await window.evaluate(() => window.cc.extensions.install({ kind: 'bundled', id: 'design-docs' }));
    expect(installed).toMatchObject({ ok: true });
  }
  const trust = window.getByRole('button', { name: 'Install with full trust' });
  if (await trust.isVisible().catch(() => false)) await trust.click();
  await expect.poll(() => window.evaluate(async () => {
    const plugin = (await window.cc.pluginApps.list()).find((plugin) => plugin.id === 'design-docs');
    if (plugin?.status === 'degraded') {
      try { await window.cc.pluginApps.callRpc('design-docs', 'groupStatus'); }
      catch (failure) { throw new Error(`Design Docs degraded: ${String(failure)}; ${JSON.stringify(plugin)}`); }
    }
    return plugin;
  }), { timeout: 30_000 }).toMatchObject({ status: expect.stringMatching(/running|needs-configuration/) });
  await window.getByRole('button', { name: 'Design Docs', exact: true }).click();
  const docList = window.locator('.dd-list');
  await expect(docList.getByText('Design docs', { exact: true })).toBeVisible();
  const before = window.url();
  const entry = docList.getByRole('button', { name: 'Settings', exact: true });
  await expect(entry).toHaveAttribute('aria-pressed', 'false');
  // A bordered header button sized like New, not a bare tab-like link.
  const [entryBox, newBox] = await Promise.all([entry.boundingBox(), docList.getByRole('button', { name: 'New', exact: true }).boundingBox()]);
  expect(entryBox!.height).toBe(newBox!.height);
  expect(await entry.evaluate((button) => getComputedStyle(button).borderTopStyle)).toBe('solid');
  expect(await docList.locator('.dd-list-head').evaluate((head) => head.scrollWidth <= head.clientWidth)).toBe(true);
  await entry.click();
  // Peer setup opens inside the plugin panel: same URL, no Plugins hub, no dialog.
  expect(window.url()).toBe(before);
  await expect(window.locator('#plugin-configure')).toHaveCount(0);
  await expect(window.getByRole('dialog', { name: 'Database sync peers' })).toHaveCount(0);
  const view = window.locator('.dd-peers-view');
  await expect(view.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  const nav = view.getByRole('navigation', { name: 'Settings sections' });
  await expect(nav.getByRole('button', { name: 'Peers', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('button', { name: 'Sharing', exact: true })).toHaveCount(0);
  await expect(nav.getByRole('button', { name: 'Agent', exact: true })).not.toHaveAttribute('aria-current', 'page');
  await expect(window.locator('.dd-list')).toHaveCount(0);
  const peers = view.getByRole('region', { name: 'Database sync peers' });
  // Core owns connections: this panel only points at them and lists what Design Docs may use.
  await expect(peers.getByRole('link', { name: 'Add or remove computers in Settings → Peers' })).toHaveAttribute('href', '/settings/peers');
  await expect(peers.getByRole('heading', { name: 'Pair another computer' })).toHaveCount(0);
  await expect(peers.getByRole('button', { name: /^(Add peer|Join peer)$/ })).toHaveCount(0);
  await expect(peers.getByLabel('Paste invitation')).toHaveCount(0);
  // No OS-protected peer key in this HOME: the connection list fails closed with a visible reason, not an empty list.
  await expect(peers.getByRole('alert')).toContainText('peer encryption key or local identity unavailable');
  await expect(peers.getByLabel('Computers')).toHaveCount(0);
  const status = await window.evaluate(() => window.cc.pluginApps.callRpc('design-docs', 'groupStatus'));
  await expect(peers).toContainText('No sync group configured.');
  await expect(peers.getByRole('button', { name: 'Enable Database Sync' })).toHaveCount(0);
  // Isolated E2E HOME has no OS-protected peer key; installed SDK must remain fail-closed.
  expect(status).toMatchObject({ configured: false, lifecycleAvailable: false, introductionsAvailable: false, installerAvailable: false, enrolled: [], members: [], jobs: [] });
  await expect(peers).toContainText('Database sync cannot start on this app');
  const error = await window.evaluate(async () => {
    try {
      await window.cc.pluginApps.callRpc('design-docs', 'enablePeer', { peerId: 'fake', members: [{ machineId: 'fake' }] });
      return 'unexpected success';
    } catch (failure) { return String(failure); }
  });
  expect(error).toContain('accepts only peerId');

  const back = view.getByRole('button', { name: 'Back to design docs', exact: true });
  await expect(back).toContainText('Design docs');
  await expect(back).toHaveAttribute('title', 'Back to design docs');
  await expect(back).toHaveAttribute('aria-pressed', 'true');
  await back.click();
  await expect(window.locator('.dd-peers-view')).toHaveCount(0);
  await expect(window.locator('.dd-list').getByRole('button', { name: 'Settings', exact: true })).toBeVisible();
  expect(window.url()).toBe(before);
  await window.locator('.dd-list').getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(peers).toContainText('No sync group configured.');

  // Seed governance only in this isolated HOME; no transport grants or OS keys are supplied.
  const db = createSqliteDatabase(join(home, '.zcc', 'plugins', 'design-docs', 'data.db'), { fileMustExist: true });
  try {
    db.pragma('busy_timeout = 5000');
    const database: PluginDatabase = {
      prepare: (sql) => db.prepare(sql), runScript: (sql) => db.exec(sql),
      migrate: (statements) => { for (const sql of statements) db.exec(sql); },
      transaction: (fn) => db.transaction(fn)()
    };
    const group = new DesignDocPeerGroup(database), local = group.sync.localRepository()!;
    const founders = [
      { replicaId: local.replicaId, machineId: 'e2e-app-a', joinedAt: 1, sponsorReplicaId: null },
      { replicaId: 'e2e-replica-b', machineId: 'e2e-app-b', joinedAt: 1, sponsorReplicaId: local.replicaId }
    ];
    const roster = appendSeat(createRoster(local.repoId, 'e2e-retirement', founders, 'e2e-found', local.replicaId), {
      kind: 'admit', seat: 3, requestId: 'e2e-join', ownerReplicaId: local.replicaId,
      member: { replicaId: 'e2e-replica-c', machineId: 'e2e-app-c', joinedAt: 2, sponsorReplicaId: local.replicaId }
    });
    database.transaction(() => {
      db.prepare('UPDATE sync_group_control SET local_peer_id = ?, roster_json = ? WHERE singleton = 1')
        .run('e2e-app-a', canonicalJson(roster));
      group.sync.setGroup(local.repoId, roster.groupId, roster.members, roster.rosterEpoch);
    });
    const retiring = group.remove('e2e-replica-b');
    expect(retiring.stage).toBe('retiring');
    // The Peers view polls; no manual Refresh.
    await expect(peers).toContainText('Sync group: 3 of 8 computers', { timeout: 20_000 });
    // Members with no core connection have no card; the roster stays authoritative for the count and for Leave Group.
    await expect(peers.getByLabel('Computers').getByRole('listitem')).toHaveCount(0);
    await expect(peers.getByRole('button', { name: 'Leave Group', exact: true })).toBeVisible();
    expect(await window.evaluate(() => window.cc.pluginApps.callRpc('design-docs', 'peerStatus')))
      .toMatchObject({ configured: true, members: expect.not.arrayContaining([expect.objectContaining({ replicaId: 'e2e-replica-b' })]) });
    // Configured: the doc list header shows the member count without overflowing or truncating.
    await view.getByRole('button', { name: 'Back to design docs', exact: true }).click();
    const configuredList = window.locator('.dd-list');
    const settings = configuredList.getByRole('button', { name: 'Settings', exact: true });
    await expect(settings).toHaveText('');
    await expect(settings).toHaveAttribute('title', 'Design Docs settings: peers and agent');
    // Sync is gated on a live peer connection. This isolated HOME seeds governance only
    // (no transport grants or OS keys, see above), so no computer is connected and Sync stays hidden.
    await expect(configuredList.getByRole('button', { name: 'Sync', exact: true })).toHaveCount(0);
    expect(await configuredList.locator('.dd-list-head').evaluate((head) => head.scrollWidth <= head.clientWidth)).toBe(true);
    expect(await configuredList.locator('.dd-list-title').evaluate((title) => title.scrollWidth <= title.clientWidth)).toBe(true);
    await configuredList.getByRole('button', { name: 'Hide doc list' }).click();
    const rail = window.getByRole('navigation', { name: 'Design docs' });
    // Same connection gate: with no connected computer the collapsed rail shows no Sync peers control.
    await expect(rail.getByRole('button', { name: 'Sync peers' })).toHaveCount(0);
    await expect(rail.getByRole('button', { name: 'Settings', exact: true })).toHaveCount(0);
    await rail.getByRole('button', { name: 'Show doc list' }).click();
    await window.locator('.dd-list').getByRole('button', { name: 'Settings', exact: true }).click();

    expect(group.remove(local.replicaId).stage).toBe('removed');
    // After leaving, the leftover roster is history: no group count and no dead cards for the former members.
    await expect(peers).toContainText('No sync group configured.', { timeout: 20_000 });
    await expect(peers).not.toContainText('Sync group:');
    await expect(peers.getByLabel('Computers').getByRole('listitem')).toHaveCount(0);
    await expect(peers.getByRole('button', { name: 'Leave Group', exact: true })).toHaveCount(0);
    expect(await window.evaluate(() => window.cc.pluginApps.callRpc('design-docs', 'peerStatus')))
      .toMatchObject({ configured: false, members: [] });
    const failure = await window.evaluate(async () => {
      try { await window.cc.pluginApps.callRpc('design-docs', 'syncNow'); return 'unexpected success'; }
      catch (error) { return String(error); }
    });
    expect(failure).toContain('design docs peer sync is not configured');
    const doc = await window.evaluate(() => window.cc.pluginApps.callRpc('design-docs', 'create', {
      title: 'Local authoring after retirement', template: 'blank', status: 'approved'
    })) as { id: string; status: string };
    expect(doc.status).toBe('approved');
    expect(db.prepare('SELECT id FROM sync_intents WHERE doc_id = ?').all(doc.id)).toEqual([]);
  } finally { db.close(); }
});
