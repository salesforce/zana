import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, expect, it } from 'vitest';
import { writePluginRecoveryArtifacts } from './plugin-recovery-artifacts.mjs';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture(name = '@zcc-ext/tasks') {
  const root = mkdtempSync(join(tmpdir(), 'recovery-pack-')); roots.push(root);
  mkdirSync(join(root, 'plugins/tasks/bin'), { recursive: true });
  writeFileSync(join(root, 'plugins/tasks/package.json'), JSON.stringify({ name }));
  writeFileSync(join(root, 'plugins/tasks/bin/run'), 'clean runtime', { mode: 0o700 });
  writeFileSync(join(root, 'plugins/README.md'), 'ignored');
  return root;
}
it('publishes platform-specific checksummed runtimes including executable and nested assets', async () => {
  const root = fixture();
  await writePluginRecoveryArtifacts(join(root, 'plugins'), join(root, 'dist'), '2.3.1', 'darwin', 'arm64');
  const index = JSON.parse(readFileSync(join(root, 'dist/plugin-recovery-darwin-arm64.json'), 'utf8'));
  expect(index).toMatchObject({ version: 1, zccVersion: '2.3.1', plugins: [{ id: 'tasks', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }] });
  const payload = JSON.parse(gunzipSync(readFileSync(join(root, 'dist', index.plugins[0].file))).toString());
  expect(payload.files).toContainEqual({ path: 'bin/run', base64: Buffer.from('clean runtime').toString('base64'), executable: process.platform !== 'win32' });
});
it('rejects invalid plugin names and symlinks', async () => {
  const invalid = fixture('invalid name');
  await expect(writePluginRecoveryArtifacts(join(invalid, 'plugins'), join(invalid, 'dist'), '2.3.1')).rejects.toThrow('identity');
  const root = fixture();
  symlinkSync(join(root, 'plugins/tasks/package.json'), join(root, 'plugins/tasks/link'));
  await expect(writePluginRecoveryArtifacts(join(root, 'plugins'), join(root, 'dist'), '2.3.1')).rejects.toThrow('symlink');
});

it('bounds depth and total bytes before reading runtime files', async () => {
  const root = fixture(); let path = join(root, 'plugins/tasks');
  for (let i = 0; i < 34; i++) { path = join(path, 'deep'); mkdirSync(path); }
  await expect(writePluginRecoveryArtifacts(join(root, 'plugins'), join(root, 'dist'), '2.3.1')).rejects.toThrow('depth');
  rmSync(join(root, 'plugins/tasks/deep'), { recursive: true });
  const large = join(root, 'plugins/tasks/large'); writeFileSync(large, ''); truncateSync(large, 65 * 1024 * 1024);
  await expect(writePluginRecoveryArtifacts(join(root, 'plugins'), join(root, 'dist'), '2.3.1')).rejects.toThrow('file limits');
});
