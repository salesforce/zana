import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

it('publishes only updater files, ignoring stale recovery assets and unrelated dist files', async () => {
  const root = mkdtempSync(join(tmpdir(), 'zcc-release-upload-'));
  const dist = join(root, 'dist'), target = join(root, 'published');
  mkdirSync(dist);
  const files = {
    'latest-mac.yml': 'files:\n  - url: Zana.zip\n  - url: https://example.test/external.zip\n',
    'Zana.zip': 'app bytes',
    'plugin-recovery-darwin-arm64.json': 'index bytes',
    'plugin-recovery-2.3.1-darwin-arm64-tasks.json.gz': 'runtime bytes'
  };
  for (const [name, value] of Object.entries(files)) writeFileSync(join(dist, name), value);
  writeFileSync(join(dist, 'private-notes.json'), 'never publish');
  writeFileSync(join(dist, 'plugin-recovery-invalid.zip'), 'never publish');
  vi.stubEnv('ZCC_RELEASE_BASE', target);
  vi.stubEnv('ZCC_RELEASE_BACKEND', 'file');
  vi.spyOn(process, 'cwd').mockReturnValue(root);
  vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    await import('./upload-release.mjs');
    expect(readdirSync(target).sort()).toEqual(['Zana.zip', 'latest-mac.yml']);
    for (const name of ['Zana.zip', 'latest-mac.yml'] as const) expect(readFileSync(join(target, name), 'utf8')).toBe(files[name]);
  } finally {
    vi.restoreAllMocks(); vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
