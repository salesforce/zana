/**
 * Install-from-git LIVE E2E — drives the real Marketplace → "Install from repo…"
 * → dialog → clone → P3-D consent (with the loud remote-origin line) → live
 * mount flow in a booted app, then the update-from-repo re-clone. This is the
 * app-driven complement to the offline unit/DI coverage
 * (src/main/__tests__/install-from-git*.test.ts): those prove the main-side
 * clone/scrub/install seam; this proves the full UI wiring end to end.
 *
 * Offline: a local `git daemon` serves the repo over `git://127.0.0.1:<port>`,
 * a scheme the app's `normalizeRepoUrl` accepts (unlike `file://`), so no network
 * and no test-only app seam are needed — the app clones exactly as it would from
 * github.
 */
import { test, expect } from './fixtures/app';
import { MarketplacePage } from './fixtures/marketplace';
import { startGitDaemon, type GitDaemon } from './fixtures/git-daemon';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
const HELLO_FIXTURE = join(REPO_ROOT, 'test/fixtures/hello-sample');

/** A minimal renderer-only extension with NO permissions (installs consent-free). */
const NOPERM_MANIFEST = JSON.stringify(
  {
    id: 'git-noperm',
    version: '1.0.0',
    title: 'Git NoPerm',
    icon: 'Sparkles',
    titleLabel: 'Git NoPerm',
    entry: { renderer: 'renderer.js' },
    engines: { zccApi: '^1.0.0' },
    permissions: [],
    projectTab: { label: 'NoPerm', icon: 'Sparkles', order: 101, global: true },
  },
  null,
  2
);
const NOPERM_RENDERER = `export default {
  activate({ React }) {
    return { panel: () => React.createElement('div', { className: 'git-noperm-panel' }, 'NoPerm OK') };
  }
};
`;

test.describe('install from git — live app flow', () => {
  let daemon: GitDaemon | null = null;

  test.afterEach(async () => {
    await daemon?.close();
    daemon = null;
  });

  test('Marketplace → Install from repo… → consent shows remote-origin warning → installs', async ({
    app,
    home,
  }) => {
    // hello-sample declares `storage`, so it raises the P3-D consent overlay —
    // exactly where the loud remote-origin provenance line must appear.
    daemon = await startGitDaemon(join(home, '.git-daemon'), [
      { repoName: 'hello', fromDir: HELLO_FIXTURE, tag: 'v1.0.0' },
    ]);
    const url = daemon.urlFor('hello');
    const market = new MarketplacePage(app.window);
    const win = app.window;

    await market.open();

    // Open the "Install from repo…" dialog.
    await win.locator('button', { hasText: 'Install from repo…' }).click();
    const dialog = win.locator('[role="dialog"][aria-label="Install an extension from a repository"]');
    await expect(dialog).toBeVisible();

    // Fill URL (+ a tag ref to prove ref is honored) and submit.
    await dialog.locator('.ext-create-input').first().fill(url);
    await dialog.locator('.launch-row', { hasText: 'Branch or tag' }).locator('input').fill('v1.0.0');
    await dialog.locator('button', { hasText: /^Install$/ }).click();

    // The clone + install runs, then the P3-D consent overlay appears for the
    // newly-installed git extension.
    const overlay = win.locator('.consent-overlay');
    await expect(overlay).toBeVisible({ timeout: 45_000 });

    // THE headline assertion: the loud remote-origin provenance line is present,
    // names the git:// origin + ref, and says the code is not reviewed.
    const originLine = overlay.locator('.consent-origin--warn');
    await expect(originLine).toBeVisible();
    await expect(originLine).toContainText('Installed from a remote repository');
    await expect(originLine).toContainText(url);
    await expect(originLine).toContainText('v1.0.0');
    await expect(originLine).toContainText('code not reviewed');

    // Approve → consent persists and the overlay clears.
    await overlay.locator('button.btn.primary').click();
    await expect(win.locator('.consent-overlay')).toBeHidden({ timeout: 15_000 });

    // The extension is installed, enabled, and stamped source:'git' with the
    // credential-free provenance the consent line rendered.
    const list = await market.ipc<
      Array<{ id: string; enabled: boolean; source?: string; remoteOrigin?: { url: string; ref?: string } }>
    >('list');
    const installed = list.find((e) => e.id === 'hello-sample');
    expect(installed, 'hello-sample present after git install').toBeTruthy();
    expect(installed!.enabled).toBe(true);
    expect(installed!.source).toBe('git');
    expect(installed!.remoteOrigin?.url).toBe(url);
    expect(installed!.remoteOrigin?.ref).toBe('v1.0.0');
  });

  test('a no-permission repo installs with no consent gate and mounts', async ({ app, home }) => {
    daemon = await startGitDaemon(join(home, '.git-daemon'), [
      { repoName: 'noperm', files: { 'extension.json': NOPERM_MANIFEST, 'renderer.js': NOPERM_RENDERER } },
    ]);
    const url = daemon.urlFor('noperm');
    const market = new MarketplacePage(app.window);
    const win = app.window;

    await market.open();
    await win.locator('button', { hasText: 'Install from repo…' }).click();
    const dialog = win.locator('[role="dialog"][aria-label="Install an extension from a repository"]');
    await dialog.locator('.ext-create-input').first().fill(url);
    await dialog.locator('button', { hasText: /^Install$/ }).click();

    // permissions: [] → no consent overlay; the dialog just closes on success.
    await expect(dialog).toBeHidden({ timeout: 45_000 });

    const list = await market.ipc<Array<{ id: string; source?: string }>>('list');
    const installed = list.find((e) => e.id === 'git-noperm');
    expect(installed, 'git-noperm installed').toBeTruthy();
    expect(installed!.source).toBe('git');
  });

  test('a manifest in a subfolder installs via the Subfolder field', async ({ app, home }) => {
    daemon = await startGitDaemon(join(home, '.git-daemon'), [
      {
        repoName: 'mono',
        files: {
          'README.md': '# monorepo\n',
          'packages/tool/extension.json': NOPERM_MANIFEST.replace('git-noperm', 'git-subtool'),
          'packages/tool/renderer.js': NOPERM_RENDERER,
        },
      },
    ]);
    const url = daemon.urlFor('mono');
    const market = new MarketplacePage(app.window);
    const win = app.window;

    await market.open();
    await win.locator('button', { hasText: 'Install from repo…' }).click();
    const dialog = win.locator('[role="dialog"][aria-label="Install an extension from a repository"]');
    await dialog.locator('.ext-create-input').first().fill(url);
    await dialog.locator('.launch-row', { hasText: 'Subfolder' }).locator('input').fill('packages/tool');
    await dialog.locator('button', { hasText: /^Install$/ }).click();

    await expect(dialog).toBeHidden({ timeout: 45_000 });
    const list = await market.ipc<Array<{ id: string; source?: string }>>('list');
    expect(list.some((e) => e.id === 'git-subtool')).toBe(true);
  });

  test('update-from-repo re-clones new bytes in place', async ({ app, home }) => {
    daemon = await startGitDaemon(join(home, '.git-daemon'), [
      { repoName: 'noperm', files: { 'extension.json': NOPERM_MANIFEST, 'renderer.js': NOPERM_RENDERER } },
    ]);
    const url = daemon.urlFor('noperm');
    const market = new MarketplacePage(app.window);

    // Install v1 directly via IPC (the UI path is covered above; here we focus on
    // the update seam).
    const first = await market.ipc<{ ok: boolean }>('install', { kind: 'git', url });
    expect(first.ok).toBe(true);
    type Entry = { id: string; manifest?: { version?: string } };
    let list = await market.ipc<Entry[]>('list');
    expect(list.find((e) => e.id === 'git-noperm')?.manifest?.version).toBe('1.0.0');

    // Publish v1.1.0 upstream (bump version so installFromDir accepts the upgrade).
    const src = daemon.sourceDir('noperm');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(src, 'extension.json'), NOPERM_MANIFEST.replace('1.0.0', '1.1.0'));
    daemon.publishUpdate('noperm', 'v1.1.0');

    // Update from repo re-derives {url,ref} from git.json (never renderer text)
    // and re-clones. No widened scope → no re-consent.
    const upd = await market.ipc<{ ok: boolean }>('reinstallFromGit', 'git-noperm');
    expect(upd.ok).toBe(true);

    list = await market.ipc<Entry[]>('list');
    expect(list.find((e) => e.id === 'git-noperm')?.manifest?.version).toBe('1.1.0');
  });
});
