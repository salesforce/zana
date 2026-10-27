/** Real pack review → host-authorized Git installs → persisted collection in built Electron. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { startGitDaemon, type GitDaemon } from './fixtures/git-daemon.js';
import { MarketplacePage } from './fixtures/marketplace.js';
import { pluginPackageJsonSchema } from '../packages/domain/src/plugin-manifest.js';

const PACK_ID = 'fixture-essentials';
const PACK_NAME = 'Fixture Essentials';
const IDS = ['pack-existing', 'pack-tools', 'pack-retry', 'pack-optional', 'pack-added'] as const;
const NAMES: Record<(typeof IDS)[number], string> = {
  'pack-existing': 'Existing Workspace',
  'pack-tools': 'Connected Tools',
  'pack-retry': 'Retry Service',
  'pack-optional': 'Optional Helper',
  'pack-added': 'Added Later'
};

function pluginFiles(id: (typeof IDS)[number], version = '1.0.0', broken = false): Record<string, string> {
  return {
    'package.json': JSON.stringify({ name: `zcc-plugin-${id}`, version: broken ? '' : version, zcc: {
      name: NAMES[id], description: 'Synthetic plugin pack fixture', branding: { icon: 'Package' }, server: './server.mjs'
    } }),
    'server.mjs': `export default zcc => {
      zcc.rpc.method('version', () => '${version}');
      zcc.rpc.method('save', () => zcc.storage.kv.set('saved', 'preserved'));
      zcc.rpc.method('read', () => zcc.storage.kv.get('saved'));
    };`
  };
}

function publishPlugin(git: GitDaemon, id: (typeof IDS)[number], version = '1.0.0') {
  for (const [name, contents] of Object.entries(pluginFiles(id, version))) {
    writeFileSync(join(git.sourceDir(id), name), contents);
  }
  git.publishUpdate(id, `Publish ${id} ${version}`);
}

type InstalledRow = { id: string; version: string; enabled: boolean; updatedAt: number };
function installed(home: string): InstalledRow[] {
  return JSON.parse(readFileSync(join(home, '.zcc/plugins/installed.json'), 'utf8')).plugins;
}

test('pack review preserves existing plugins, retries partial installs, and never silently adds members', async ({ home }) => {
  test.setTimeout(300_000);
  // Validate the failure itself before spending time building or booting Electron.
  expect(pluginPackageJsonSchema.safeParse(JSON.parse(pluginFiles('pack-retry', '1.0.0', true)['package.json']!)).success).toBe(false);
  const git = await startGitDaemon(join(home, 'pack-git'), IDS.map(id => ({
    repoName: id, files: pluginFiles(id, '1.0.0', id === 'pack-retry')
  })));
  const catalogDir = join(home, 'pack-catalog');
  const emptyBundled = join(home, 'empty-bundled');
  mkdirSync(catalogDir, { recursive: true });
  mkdirSync(emptyBundled, { recursive: true });
  writeFileSync(join(catalogDir, 'marketplace.json'), JSON.stringify({
    schemaVersion: 1, name: 'pack-fixtures', displayName: 'Pack Fixtures',
    plugins: IDS.map(id => ({ id, displayName: NAMES[id], description: 'Synthetic plugin pack fixture',
      author: { name: 'E2E fixture' }, source: { git: { url: git.urlFor(id) } } }))
  }));
  const writePack = (includeAdded = false) => writeFileSync(join(catalogDir, 'packs.json'), JSON.stringify({
    schemaVersion: 1, packs: [{ id: PACK_ID, displayName: PACK_NAME,
      description: 'Independent plugins, installed together after review.',
      members: [
        { pluginId: 'pack-existing', required: true },
        { pluginId: 'pack-tools', required: true },
        { pluginId: 'pack-retry', required: true },
        { pluginId: 'pack-optional' },
        ...(includeAdded ? [{ pluginId: 'pack-added' }] : [])
      ] }]
  }));
  writePack();
  const source = `path:${catalogDir}`;
  const env = {
    ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off',
    ZCC_COMMUNITY_MARKETPLACE_SOURCE: 'off', ZCC_SKIP_PLUGIN_NPM: '1',
    ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0',
    ZCC_BUNDLED_PLUGINS_DIR: emptyBundled, ZCC_BUNDLED_EXTENSIONS_DIR: emptyBundled,
    // Linux/Xvfb hidden windows throttle the compositor used by screenshot capture.
    ...(process.platform === 'linux' ? { ZCC_E2E_VISIBLE: '1' } : {})
  };
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    app = await launchApp(home, { env });
    let win = app.window;
    // Establish an independent, disabled installation with saved state before the pack exists.
    expect(await win.evaluate(url => window.cc.extensions.install({ kind: 'git', url }), git.urlFor('pack-existing'))).toMatchObject({ ok: true });
    await win.evaluate(() => window.cc.pluginApps.callRpc('pack-existing', 'save'));
    expect(await win.evaluate(() => window.cc.pluginApps.setEnabled('pack-existing', false))).toMatchObject({ ok: true });
    const existingBefore = installed(home).find(row => row.id === 'pack-existing')!;
    publishPlugin(git, 'pack-existing', '2.0.0');

    // Add the catalogue through the same UI users use. All sources are synthetic and under this test HOME.
    const market = new MarketplacePage(win);
    await market.open();
    await market.openCatalogSources();
    await win.getByLabel('Marketplace catalog source').fill(source);
    await win.getByRole('button', { name: 'Add catalog', exact: true }).click();
    await expect(market.catalogNames()).toHaveText(['Pack Fixtures']);
    await win.getByRole('dialog', { name: 'Manage marketplaces', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
    const packs = win.getByRole('region', { name: 'Plugin packs', exact: true });
    await expect(packs.getByTestId(`plugin-pack-${PACK_ID}`)).toBeVisible();
    await packs.getByRole('button', { name: 'Review pack', exact: true }).click();
    let review = win.getByRole('dialog', { name: `Review ${PACK_NAME}`, exact: true });
    await expect(review.getByTestId('plugin-pack-member-pack-existing')).toContainText('Already installed');
    await expect(review.getByTestId('plugin-pack-member-pack-existing').getByRole('checkbox')).toHaveCount(0);
    await review.getByRole('checkbox', { name: `Include ${NAMES['pack-optional']}`, exact: true }).uncheck();
    await expect(review).toContainText('full trust');
    const geometry = await review.evaluate((dialog) => {
      const rect = dialog.getBoundingClientRect();
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: innerWidth, height: innerHeight };
    });
    await test.info().attach('review-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' });
    expect(geometry.left).toBeGreaterThanOrEqual(0);
    expect(geometry.right).toBeLessThanOrEqual(geometry.width);
    expect(geometry.top).toBeGreaterThanOrEqual(0);
    expect(geometry.bottom).toBeLessThanOrEqual(geometry.height);
    // Viewport artifacts avoid locator-screenshot stability waits; layout is asserted above.
    await win.screenshot({ path: test.info().outputPath('pack-review.png'), animations: 'disabled' });
    await review.getByRole('button', { name: 'Install selected plugins', exact: true }).click();

    // A real manifest validation failure is visible; successful members remain installed and the optional stays out.
    await expect(review.getByTestId('plugin-pack-member-pack-retry').getByRole('alert')).toBeVisible({ timeout: 60_000 });
    await expect(review.getByRole('button', { name: 'Retry failed plugins', exact: true })).toBeEnabled();
    expect(installed(home).map(row => row.id).sort()).toEqual(['pack-existing', 'pack-tools']);
    expect(installed(home).find(row => row.id === 'pack-existing')).toMatchObject({
      version: '1.0.0', enabled: false, updatedAt: existingBefore.updatedAt
    });
    const successfulBeforeRetry = installed(home).find(row => row.id === 'pack-tools')!;
    await win.evaluate(() => window.cc.pluginApps.callRpc('pack-tools', 'save'));
    publishPlugin(git, 'pack-tools', '2.0.0');
    publishPlugin(git, 'pack-retry');
    await review.getByRole('button', { name: 'Retry failed plugins', exact: true }).click();
    await expect(review.getByRole('button', { name: 'Done', exact: true })).toBeEnabled({ timeout: 60_000 });
    expect(installed(home).find(row => row.id === 'pack-tools')).toMatchObject({
      version: '1.0.0', updatedAt: successfulBeforeRetry.updatedAt
    });
    expect(await win.evaluate(() => window.cc.pluginApps.callRpc('pack-tools', 'read'))).toBe('preserved');
    await review.getByRole('button', { name: 'Done', exact: true }).click();

    // A later catalogue refresh can advertise an extra member, but cannot install it or update old members.
    writePack(true);
    expect(await win.evaluate(async value => {
      const response = await fetch('/api/v1/marketplaces/refresh', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: value })
      });
      return response.ok;
    }, source)).toBe(true);
    await closeApp(app.electron);
    app = await launchApp(home, { env });
    win = app.window;
    await win.getByTestId('nav-extensions').click();
    await win.getByTestId('extensions-nav-installed').click();
    const remembered = win.getByRole('region', { name: 'Installed plugin packs', exact: true });
    await expect(remembered.getByTestId(`plugin-pack-${PACK_ID}`)).toBeVisible();
    await win.screenshot({ path: test.info().outputPath('installed-pack.png'), animations: 'disabled' });
    expect(installed(home).map(row => row.id).sort()).toEqual(['pack-existing', 'pack-retry', 'pack-tools']);
    expect(installed(home).find(row => row.id === 'pack-existing')).toMatchObject({ version: '1.0.0', enabled: false });
    expect(installed(home).find(row => row.id === 'pack-tools')).toMatchObject({ version: '1.0.0' });
    await remembered.getByRole('button', { name: 'Manage pack', exact: true }).click();
    review = win.getByRole('dialog', { name: `Review ${PACK_NAME}`, exact: true });
    await expect(review.getByTestId('plugin-pack-member-pack-added')).toBeVisible();
    await review.getByRole('button', { name: 'Cancel', exact: true }).click();

    // Forgetting is a grouping operation only. Installed versions, disabled state and saved data survive.
    await remembered.getByRole('button', { name: 'Forget pack', exact: true }).click();
    const forget = win.getByRole('dialog', { name: `Forget ${PACK_NAME}?`, exact: true });
    await expect(forget).toContainText('plugins stay installed');
    await forget.getByRole('button', { name: 'Forget pack', exact: true }).click();
    await expect(remembered).toHaveCount(0);
    expect(installed(home).map(row => row.id).sort()).toEqual(['pack-existing', 'pack-retry', 'pack-tools']);
    expect(installed(home).find(row => row.id === 'pack-existing')).toMatchObject({ version: '1.0.0', enabled: false });
    expect(await win.evaluate(() => window.cc.pluginApps.callRpc('pack-tools', 'read'))).toBe('preserved');
    await win.evaluate(() => window.cc.pluginApps.setEnabled('pack-existing', true));
    expect(await win.evaluate(() => window.cc.pluginApps.callRpc('pack-existing', 'read'))).toBe('preserved');
  } finally {
    if (app) await closeApp(app.electron);
    await git.close();
  }
});
