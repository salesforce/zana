import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterEach, expect, it, vi } from 'vitest';
import { copyRecoveryRollbackRuntime, createOfficialPluginRecovery, fetchRecoveryBytes, pluginRecoveryUrl } from './plugin-recovery-runtime.js';

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })); });
const signal = () => new AbortController().signal;
function fixture(overrides: { id?: string; files?: unknown[]; index?: Record<string, unknown>; checksum?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'plugin-recovery-')); roots.push(root);
  const bytes = gzipSync(JSON.stringify({ version: 1, id: overrides.id ?? 'tasks', files: overrides.files ?? [
    { path: 'package.json', base64: Buffer.from('{}').toString('base64'), executable: false },
    { path: 'bin/run', base64: Buffer.from('hello').toString('base64'), executable: true }
  ] }));
  const index = { version: 1, zccVersion: '2.3.1', plugins: [{ id: 'tasks', file: 'plugin-recovery-tasks.json.gz', sha256: overrides.checksum ?? createHash('sha256').update(bytes).digest('hex') }], ...overrides.index };
  const fetcher = vi.fn(async (url: URL) => new Response(url.pathname.endsWith('.gz') ? new Uint8Array(bytes) : JSON.stringify(index)));
  const recover = createOfficialPluginRecovery({ dataDir: root, hostVersion: '2.3.1', signal: signal(), fetcher: fetcher as never });
  return { root, index, bytes, fetcher, recover };
}

it('uses versioned official releases and honors the host mirror', () => {
  vi.stubEnv('ZCC_PLUGIN_RECOVERY_URL', '');
  expect(pluginRecoveryUrl('2.3.1')).toContain('/releases/download/v2.3.1/plugin-recovery-');
  vi.stubEnv('ZCC_PLUGIN_RECOVERY_URL', 'https://mirror.test/index.json');
  expect(pluginRecoveryUrl('2.3.1')).toBe('https://mirror.test/index.json');
});

it('downloads fresh runtime generations, reuses the index per run and preserves file bytes and permissions', async () => {
  const { recover, fetcher } = fixture();
  const first = await recover('tasks'), second = await recover('tasks');
  expect(first).not.toBe(second);
  expect(readFileSync(join(first, 'bin/run'), 'utf8')).toBe('hello');
  if (process.platform !== 'win32') expect(statSync(join(first, 'bin/run')).mode & 0o777).toBe(0o700);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it.each([
  [{ index: { zccVersion: '9.0.0' } }, 'target Zana'],
  [{ checksum: '0'.repeat(64) }, 'checksum'],
  [{ id: 'different' }, 'identity'],
  [{ index: { plugins: [] } }, 'No published'],
])('rejects invalid official runtimes: %s', async (override, message) => {
  const { recover } = fixture(override);
  await expect(recover('tasks')).rejects.toThrow(message);
});

it('rejects duplicate plugin entries', async () => {
  const { recover, index } = fixture();
  index.plugins.push(index.plugins[0]!);
  await expect(recover('tasks')).rejects.toThrow('Duplicate');
});

it.each(['../escape', '/absolute', 'a\\b', 'C:drive', 'a\0b', 'a//b', './a', 'a/../b'])('rejects unsafe paths and cleans candidate files: %s', async path => {
  const { root, recover } = fixture({ files: [{ path: 'safe', base64: '', executable: false }, { path, base64: '', executable: false }] });
  await expect(recover('tasks')).rejects.toThrow('file path');
  expect(readdirSync(join(root, 'plugins/generations'))).toEqual([]);
});

it.each([
  [{ path: 'A', base64: '', executable: false }, { path: 'a', base64: '', executable: false }],
  [{ path: 'bad', base64: 'bad-base64!', executable: false }]
])('rejects duplicate paths and invalid encodings', async (...files) => {
  const { recover } = fixture({ files });
  await expect(recover('tasks')).rejects.toThrow();
});

it('cleans up when an output path conflicts with a file', async () => {
  const { root, recover } = fixture({ files: [{ path: 'a', base64: '', executable: false }, { path: 'a/b', base64: '', executable: false }] });
  await expect(recover('tasks')).rejects.toThrow();
  expect(readdirSync(join(root, 'plugins/generations'))).toEqual([]);
});

it('accepts safe HTTPS redirects and loopback mirrors and refuses other destinations', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/asset' } }))
    .mockResolvedValueOnce(new Response('ok'));
  expect((await fetchRecoveryBytes('https://github.com/release', 10, signal(), fetcher)).toString()).toBe('ok');
  expect((await fetchRecoveryBytes('http://127.0.0.1:1234/index', 10, signal(), vi.fn(async () => new Response('ok')))).toString()).toBe('ok');
  for (const url of ['http://example.test/index', 'https://user:secret@example.test/index', 'file:///tmp/index']) {
    await expect(fetchRecoveryBytes(url, 10, signal(), fetcher)).rejects.toThrow('requires HTTPS');
  }
  await expect(fetchRecoveryBytes('https://github.com/index', 10, signal(), vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/a' } })))).rejects.toThrow('requires HTTPS');
});

it('bounds bytes, redirects and response failures', async () => {
  await expect(fetchRecoveryBytes('https://mirror.test/index', 1, signal(), vi.fn(async () => new Response('long')))).rejects.toThrow('size limit');
  await expect(fetchRecoveryBytes('https://mirror.test/index', 10, signal(), vi.fn(async () => new Response(null, { status: 404 })))).rejects.toThrow('(404)');
  await expect(fetchRecoveryBytes('https://mirror.test/index', 10, signal(), vi.fn(async () => new Response(null, { status: 302 })))).rejects.toThrow('no location');
  await expect(fetchRecoveryBytes('https://mirror.test/index', 10, signal(), vi.fn(async () => new Response(null, { status: 302, headers: { location: '/again' } })))).rejects.toThrow('Too many');
});

it('aborts before writing runtime files', async () => {
  const { root, fetcher } = fixture();
  const controller = new AbortController(); controller.abort();
  const recover = createOfficialPluginRecovery({ dataDir: root, hostVersion: '2.3.1', signal: controller.signal, fetcher: fetcher as never });
  await expect(recover('tasks')).rejects.toThrow();
  expect(existsSync(join(root, 'plugins/generations'))).toBe(false);
});

it('snapshots rollback files, handles missing code and rejects excessive or escaping trees', async () => {
  const { root } = fixture();
  const source = join(root, 'source'); mkdirSync(source);
  writeFileSync(join(source, 'old.mjs'), 'old code');
  const backup = await copyRecoveryRollbackRuntime(root, source);
  expect(readFileSync(join(backup, 'old.mjs'), 'utf8')).toBe('old code');
  expect(readdirSync(await copyRecoveryRollbackRuntime(root, join(root, 'missing')))).toEqual([]);
  symlinkSync(join(root, 'outside'), join(source, 'escape'));
  writeFileSync(join(root, 'outside'), 'outside');
  await expect(copyRecoveryRollbackRuntime(root, source)).rejects.toThrow('escapes');
  rmSync(join(source, 'escape'));
  writeFileSync(join(source, 'large'), ''); truncateSync(join(source, 'large'), 65 * 1024 * 1024);
  await expect(copyRecoveryRollbackRuntime(root, source)).rejects.toThrow('size limit');
  expect(readdirSync(join(root, 'plugins/generations'))).toHaveLength(2);
});
