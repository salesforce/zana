import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test, expect } from './fixtures/app.js';

type LibraryBridge = { cc: { library: {
  list(): Promise<Array<{ relPath: string }>>;
  read(scope: string, relPath: string): Promise<{ ok: boolean; content?: string }>;
} } };

const repo = fileURLToPath(new URL('..', import.meta.url));
const run = promisify(execFile);
test.use({ launchEnv: { ZCC_FAKE_PROVIDER: '1' } });

test('Library and the built app survive concurrent Node and Electron SQLite preparation', async ({ app }) => {
  const require = createRequire(import.meta.url);
  const addon = join(dirname(require.resolve('better-sqlite3/package.json')), 'build/Release/better_sqlite3.node');
  const checksum = () => createHash('sha256').update(readFileSync(addon)).digest('hex');
  const before = checksum();
  const appHome = await app.electron.evaluate(({ app }) => app.getPath('home'));
  expect(realpathSync(appHome)).toBe(realpathSync(app.home));
  expect(realpathSync(process.env.ZCC_E2E_APP_ROOT!)).not.toBe(realpathSync(repo));
  expect(await app.electron.evaluate(() => process.argv))
    .toContain(join(process.env.ZCC_E2E_APP_ROOT!, 'out/main/index.js'));

  mkdirSync(join(app.home, '.zcc', 'library'), { recursive: true });
  writeFileSync(join(app.home, '.zcc', 'library', 'isolation-witness.md'), '# Isolation witness\n\nLibrary remains available while runtimes prepare.\n');
  await expect.poll(() => app.window.evaluate(async () =>
    (await (window as unknown as LibraryBridge).cc.library.list()).some((doc) => doc.relPath === 'isolation-witness.md')
  )).toBe(true);

  await app.window.getByRole('navigation', { name: 'Main navigation' }).getByRole('button', { name: 'Docs', exact: true }).click();
  await app.window.getByText('isolation-witness.md', { exact: true }).click();
  await expect(app.window.getByRole('heading', { name: 'Isolation witness', exact: true })).toBeVisible();
  const preparation = Promise.all([false, true].map((electron) => run(process.execPath,
    ['scripts/ensure-better-sqlite3.mjs', ...(electron ? ['--electron'] : [])],
    { cwd: repo, timeout: 60_000, maxBuffer: 1024 * 1024 }
  )));
  await Promise.all([preparation, (async () => {
    await app.window.reload();
    await app.window.getByText('isolation-witness.md', { exact: true }).click();
    await expect(app.window.getByRole('heading', { name: 'Isolation witness', exact: true })).toBeVisible();
  })()]);
  expect(checksum()).toBe(before);
  const read = await app.window.evaluate(() => (window as unknown as LibraryBridge).cc.library.read('global', 'isolation-witness.md'));
  expect(read).toMatchObject({ ok: true, content: expect.stringContaining('Library remains available') });
});
