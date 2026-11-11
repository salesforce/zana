import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, launchApp, closeApp } from './fixtures/app.js';
import { startGitHttpServer } from './fixtures/git-http.js';

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

for (const workingCredentials of [false, true]) {
  test(`employee HTTPS Git uses ${workingCredentials ? 'working existing credentials before gh' : 'a scoped gh fallback and recovers after a failed retry'}`, async ({ home }, testInfo) => {
    test.skip(process.platform === 'win32', 'fixture credential helpers are POSIX shell scripts');
    test.setTimeout(180_000);
    const id = 'credential-fixture-tool';
    const work = join(home, 'git-fixture');
    let requireAuth = false;
    const accepted = `Basic ${Buffer.from('fixture-user:fixture-good').toString('base64')}`;
    const git = await startGitHttpServer(work, [
      { repoName: 'catalog', files: { 'marketplace.json': '{}' } },
      { repoName: 'tool', files: {
        'package.json': JSON.stringify({ name: `zcc-plugin-${id}`, version: '1.0.0', zcc: {
          name: 'Credential Fixture Tool', description: 'HTTPS credential fixture', branding: { icon: 'Package' }, server: './server.mjs' } }),
        'server.mjs': 'export default zcc => { zcc.rpc.method("health", () => ({ ok: true })); };'
      } }
    ], { authorize: authorization => !requireAuth || authorization === accepted });
    let app: Awaited<ReturnType<typeof launchApp>> | undefined;
    try {
      const host = new URL(git.baseUrl).host;
      const source = `git:${git.urlFor('catalog')}`;
      const config = join(home, '.gitconfig');
      const gitEnv = { ...process.env, HOME: home, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'E2E', GIT_AUTHOR_EMAIL: 'e2e@example.com', GIT_COMMITTER_NAME: 'E2E', GIT_COMMITTER_EMAIL: 'e2e@example.com' };
      const catalog = join(work, 'src/catalog');
      writeFileSync(join(catalog, 'marketplace.json'), JSON.stringify({ schemaVersion: 1, name: 'credential-fixtures', displayName: 'Credential Fixtures',
        plugins: [{ id, displayName: 'Credential Fixture Tool', description: 'HTTPS credential fixture', author: { name: 'E2E' }, source: { git: { url: git.urlFor('tool') } } }] }));
      writeFileSync(join(catalog, 'packs.json'), JSON.stringify({ schemaVersion: 1, packs: [{ id: 'starter', displayName: 'Fixture Starter', description: 'Fixture tools', members: [{ pluginId: id, required: true }] }] }));
      for (const args of [['add', '.'], ['commit', '-qm', 'catalog'], ['push', '-q', join(work, 'bare/catalog.git'), 'main']]) {
        execFileSync('git', args, { cwd: catalog, env: gitEnv, stdio: 'ignore' });
      }
      requireAuth = true;
      const helpers = join(home, "fixture CLI's bin"); mkdirSync(helpers);
      const gh = join(helpers, 'gh');
      const ghLog = join(home, 'gh-calls');
      const activePassword = join(home, 'gh-password');
      writeFileSync(activePassword, 'fixture-bad');
      // More than 8 KiB verifies status capture through the production Electron child boundary.
      const authStatus = JSON.stringify({ hosts: { [host]: [{ state: 'success', active: true, login: 'fixture-user' }] }, padding: 'x'.repeat(12_000) });
      writeFileSync(gh, `#!/bin/sh
printf '%s\\n' "$*" >> "$ZCC_FIXTURE_GH_LOG"
case "$1 $2" in
  "auth status") printf '%s' ${quote(authStatus)} ;;
  "auth git-credential")
    host=''
    while IFS= read -r line; do case "$line" in host=*) host="\${line#host=}" ;; esac; done
    [ "$host" = "$ZCC_FIXTURE_GIT_HOST" ] || exit 1
    if [ "$3" = get ]; then printf 'username=fixture-user\\npassword='; /bin/cat "$ZCC_FIXTURE_GH_PASSWORD"; printf '\\n'; fi ;;
  *) exit 2 ;;
esac
`);
      chmodSync(gh, 0o755);
      const legacy = join(helpers, 'legacy-helper');
      writeFileSync(legacy, `#!/bin/sh
printf 'legacy %s\\n' "$*" >> "$ZCC_FIXTURE_GH_LOG"
/bin/cat > /dev/null
if [ "$1" = get ] && [ "$ZCC_FIXTURE_EXISTING_CREDENTIALS" = 1 ]; then printf 'username=fixture-user\\npassword=fixture-good\\n'; fi
`);
      chmodSync(legacy, 0o755);
      execFileSync('git', ['config', '--file', config, 'credential.helper', `!${quote(legacy)}`], { env: gitEnv });
      const originalConfig = readFileSync(config, 'utf8');
      const empty = join(home, 'empty-bundled'); mkdirSync(empty);
      const env = {
        ZCC_ONBOARDING_PROFILE: JSON.stringify({ id: 'example-employees', organization: 'Example', question: 'Are you an Example employee?',
          prerequisite: 'Connect to the corporate network.', marketplaceSource: source, gitAuth: { host, method: 'gh-device' } }),
        ZCC_OFFICIAL_MARKETPLACE_URL: 'off', ZCC_INTERNAL_MARKETPLACE_SOURCE: 'off', ZCC_COMMUNITY_MARKETPLACE_SOURCE: 'off',
        ZCC_SKIP_PLUGIN_NPM: '1', ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD: '0', ZCC_BUNDLED_PLUGINS_DIR: empty, ZCC_BUNDLED_EXTENSIONS_DIR: empty,
        ZCC_GH_BINARY: gh, GIT_CONFIG_GLOBAL: config, GIT_CONFIG_NOSYSTEM: '1', GIT_SSL_CAINFO: git.caCertPath,
        ZCC_FIXTURE_GH_LOG: ghLog, ZCC_FIXTURE_GIT_HOST: host, ZCC_FIXTURE_GH_PASSWORD: activePassword,
        ZCC_FIXTURE_EXISTING_CREDENTIALS: workingCredentials ? '1' : '0'
      };
      if (workingCredentials) {
        // Prove the fixture's existing credentials work independently of Zana.
        await promisify(execFile)('git', ['ls-remote', git.urlFor('catalog')], {
          env: { ...gitEnv, ...env, GIT_TERMINAL_PROMPT: '0' }, timeout: 10_000
        });
        await promisify(execFile)('git', ['clone', '--depth', '1', '--', git.urlFor('catalog'), join(home, 'preflight-clone')], {
          env: { ...gitEnv, ...env, GIT_TERMINAL_PROMPT: '0' }, timeout: 10_000
        });
      }
      app = await launchApp(home, { env, initialConfig: { onboarding: undefined, sponsorPromptDismissed: true, theme: 'light' } });
      const win = app.window;
      const wizard = win.getByRole('dialog', { name: 'Set up Zana', exact: true });
      await wizard.getByRole('button', { name: 'Yes, set up Example tools' }).click();
      await wizard.getByRole('button', { name: 'Check access and continue' }).click();
      if (!workingCredentials) {
        await expect(wizard).toContainText('Signed in as fixture-user, but the marketplace download failed.');
        await expect(wizard).toContainText('Could not access the repository');
        await expect(wizard).not.toContainText('this account can’t read');
        await expect(wizard).not.toContainText('Ask your marketplace administrator');
        await testInfo.attach('recoverable-git-auth-failure', { body: await win.screenshot(), contentType: 'image/png' });
        expect(readFileSync(config, 'utf8')).toBe(originalConfig);
        writeFileSync(activePassword, 'fixture-good');
        await wizard.getByRole('button', { name: 'Retry access check' }).click();
      }
      await expect(wizard).toContainText('Choose your starting bundle');
      // Refresh uses the same credentials after a successful initial add.
      await wizard.getByRole('button', { name: 'Back to access check' }).click();
      await wizard.getByRole('button', { name: 'Check access and continue' }).click();
      await expect(wizard).toContainText('Choose your starting bundle');
      await wizard.getByRole('button', { name: 'Install and continue', exact: true }).click();
      await expect(wizard).toContainText('Finish connecting your tools');
      expect(JSON.parse(readFileSync(join(home, '.zcc/plugins/installed.json'), 'utf8')).plugins)
        .toEqual(expect.arrayContaining([expect.objectContaining({ id, version: '1.0.0' })]));
      // Updates exercise ls-remote and the exact-commit fetch path, using the
      // same per-command helper rather than depending on a globally saved fix.
      const tool = join(work, 'src/tool');
      const manifest = JSON.parse(readFileSync(join(tool, 'package.json'), 'utf8'));
      writeFileSync(join(tool, 'package.json'), JSON.stringify({ ...manifest, version: '1.1.0' }));
      for (const args of [['add', '.'], ['commit', '-qm', 'tool update'], ['push', '-q', join(work, 'bare/tool.git'), 'main']]) {
        execFileSync('git', args, { cwd: tool, env: gitEnv, stdio: 'ignore' });
      }
      await win.evaluate(() => window.cc.pluginApps.checkUpdates());
      const plugin = await win.evaluate(async id => (await window.cc.pluginApps.list()).find(row => row.id === id), id);
      expect(plugin).toMatchObject({ availableVersion: '1.1.0', updateCheck: { outcome: 'available' } });
      expect(await win.evaluate(id => window.cc.pluginApps.applyUpdate(id), id)).toMatchObject({ ok: true });
      expect(JSON.parse(readFileSync(join(home, '.zcc/plugins/installed.json'), 'utf8')).plugins)
        .toEqual(expect.arrayContaining([expect.objectContaining({ id, version: '1.1.0' })]));
      const calls = readFileSync(ghLog, 'utf8');
      expect(calls).not.toContain('auth setup-git');
      expect(calls).not.toContain('auth login');
      expect(calls.includes('auth git-credential get')).toBe(!workingCredentials);
      expect(readFileSync(config, 'utf8')).toBe(originalConfig);
      await expect(wizard).not.toContainText('fixture-good');
      await expect(wizard).not.toContainText('fixture-bad');
      await testInfo.attach('https-git-onboarding-complete', { body: await win.screenshot(), contentType: 'image/png' });
    } finally { if (app) await closeApp(app.electron); await git.close(); }
  });
}
