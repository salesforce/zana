import { mkdirSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { test as base, expect } from './fixtures/app.js';
import { DISABLED_CLAUDE_BINARY } from './fixtures/app-config.js';

// A directory the launcher puts in front of PATH must stay ahead of the
// login-shell PATH in the built app's main process. On macOS the login shell
// runs path_helper, which would otherwise push it behind /usr/local/bin and
// /opt/homebrew/bin and let a real CLI win over a test fake.
const test = base.extend({
  launchEnv: async ({ home }, use) => {
    const launchBin = join(home, 'launch-bin');
    mkdirSync(launchBin, { recursive: true });
    await use({ ZCC_FAKE_PROVIDER: '1', PATH: `${launchBin}${delimiter}${process.env.PATH ?? ''}` });
  },
});

test('launch-only PATH directories stay ahead of the login-shell directories', async ({ app, home }) => {
  const path = await app.electron.evaluate(() => process.env.PATH ?? '');
  const dirs = path.split(delimiter);
  const isolatedBin = dirname(DISABLED_CLAUDE_BINARY);
  const launchBin = join(home, 'launch-bin');
  const realHome = process.env.HOME ?? '';
  console.log(`main PATH (first 15): ${dirs.slice(0, 15).join(delimiter).replaceAll(realHome, '~')}`);

  const system = (process.platform === 'darwin' ? ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin'] : ['/usr/bin']).filter((dir) => dirs.includes(dir));
  for (const [name, dir] of [['launch-bin', launchBin], ['isolated-cli-bin', isolatedBin]] as const) {
    const at = dirs.indexOf(dir);
    expect(at, `${name} (${dir}) is missing from the main process PATH`).toBeGreaterThanOrEqual(0);
    for (const other of system) {
      expect(at, `${name} (${dir}) lost to ${other} in the main process PATH`).toBeLessThan(dirs.indexOf(other));
    }
  }
});
