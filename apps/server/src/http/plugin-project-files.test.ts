import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, upsertHost, createEnvironment, createConversationThread } from '@zana-ai/zcc-db';
import { HostRpcCommandSchema } from '@zana-ai/zcc-contracts/host-rpc';
import { createCommandRuntime, dispatchHostCommand } from '../../../host-daemon/src/command-dispatch.js';
import { readPluginProjectFile, writePluginProjectFile } from './plugin-project-files.js';
import type { ProductHttpContext } from './product-context.js';
const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach(fn => fn()));
function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'plugin-machines-')));
  const a = join(root, 'a'), b = join(root, 'b'); mkdirSync(a); mkdirSync(b);
  writeFileSync(join(a, 'file.ts'), 'a'); writeFileSync(join(b, 'file.ts'), 'b');
  const db = openDatabase(join(root, 'data/zcc.sqlite'));
  cleanups.push(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  upsertHost(db, { id: 'a', name: 'a', hostKeyHash: 'hash', isPrimary: true });
  upsertHost(db, { id: 'b', name: 'b', hostKeyHash: 'hash' });
  const project = { id: 'p', path: a, hostId: 'a', name: 'P', createdAt: 1, lastActiveAt: 1, sources: [{ id: 'b', hostId: 'b', path: b }] };
  const runtime = createCommandRuntime({ dataDir: join(root, 'daemon') });
  const rpc = vi.fn(async ({ command }: any) => dispatchHostCommand(runtime, HostRpcCommandSchema.parse(command)));
  const ctx = { db, toProjects: () => [project], hostHub: { callHostOnlineRpc: rpc } } as unknown as ProductHttpContext;
  const source = { kind: 'workspace', projectId: 'p', environmentId: null, threadId: null };
  return { root, a, b, ctx, rpc, project, source };
}
it('edits the selected machine through real confined host handlers and preserves newer edits', async () => {
  const { a, b, ctx, rpc, source } = setup();
  const args = { path: 'file.ts', source: { ...source, hostId: 'b' } };
  const file = await readPluginProjectFile(ctx, args); expect(file.content).toBe('b');
  expect(rpc).toHaveBeenLastCalledWith({ hostId: 'b', command: { type: 'host.read_path', rootPath: b, path: join(b, 'file.ts') } });
  expect(await writePluginProjectFile(ctx, { ...args, content: 'b edited', expectedSha256: file.sha256 })).toMatchObject({ outcome: 'written' });
  expect(await writePluginProjectFile(ctx, { ...args, content: 'stale', expectedSha256: file.sha256 })).toMatchObject({ outcome: 'conflict' });
  expect(readFileSync(join(a, 'file.ts'), 'utf8')).toBe('a');
  expect(readFileSync(join(b, 'file.ts'), 'utf8')).toBe('b edited');
  expect((await readPluginProjectFile(ctx, { path: 'file.ts', source })).content).toBe('a');
  symlinkSync(a, join(b, 'escape'));
  await expect(readPluginProjectFile(ctx, { ...args, path: 'escape/file.ts' })).rejects.toThrow();
  await expect(writePluginProjectFile(ctx, { ...args, path: 'escape/file.ts', content: 'bad', expectedSha256: file.sha256 })).rejects.toThrow();
});
it('confines writes even when creating missing parents', async () => {
  const { root, a, b, ctx, source } = setup();
  const selected = { ...source, hostId: 'b' };
  const created = await writePluginProjectFile(ctx, {
    path: 'new/nested/file.ts', source: selected, content: 'new', expectedSha256: null
  });
  expect(created.outcome).toBe('written');
  expect(readFileSync(join(b, 'new/nested/file.ts'), 'utf8')).toBe('new');
  for (const path of ['../outside/file.ts', '/tmp/outside/file.ts']) {
    await expect(writePluginProjectFile(ctx, { path, source: selected, content: 'bad', expectedSha256: null })).rejects.toThrow();
  }
  symlinkSync(a, join(b, 'linked'));
  await expect(writePluginProjectFile(ctx, {
    path: 'linked/new/file.ts', source: selected, content: 'bad', expectedSha256: null
  })).rejects.toThrow();
  expect(() => readFileSync(join(root, 'outside/file.ts'))).toThrow();
  expect(() => readFileSync(join(a, 'new/file.ts'))).toThrow();
});
it('pins thread files to the saved environment and rejects forged associations', async () => {
  const { b, ctx, source } = setup();
  const env = createEnvironment(ctx.db, { projectId: 'p', hostId: 'b', path: b, status: 'ready' });
  const thread = createConversationThread(ctx.db, { projectId: 'p', hostId: 'b', environmentId: env.id, providerId: 'test' });
  const args = { path: 'file.ts', source: { ...source, threadId: thread.id } };
  expect((await readPluginProjectFile(ctx, args)).content).toBe('b');
  expect((await readPluginProjectFile(ctx, { path: 'file.ts', source: { ...source, environmentId: env.id } })).content).toBe('b');
  for (const patch of [{ hostId: 'a' }, { environmentId: 'wrong' }, { threadId: 'wrong' }]) await expect(readPluginProjectFile(ctx, { ...args, source: { ...args.source, ...patch } })).rejects.toThrow();
  await expect(readPluginProjectFile(ctx, { path: 'file.ts', source: { ...source, environmentId: 'missing' } })).rejects.toThrow();
});
it('rejects missing owners, oversized writes, invalid revisions and paths before host access', async () => {
  const { ctx, source, rpc, project } = setup();
  for (const patch of [{ kind: 'host' }, { projectId: null }, { projectId: 'missing' }, { hostId: 'missing' }]) await expect(readPluginProjectFile(ctx, { path: 'file.ts', source: { ...source, ...patch } })).rejects.toThrow();
  for (const path of ['../outside', '/etc/passwd', '.', 'a\u0000b']) await expect(readPluginProjectFile(ctx, { path, source })).rejects.toThrow();
  for (const extra of [{ content: 'x', expectedSha256: 'bad' }, { content: 'x' }, { content: 'x'.repeat(8 * 1024 * 1024 + 1), expectedSha256: null }]) await expect(writePluginProjectFile(ctx, { path: 'file.ts', source, ...extra })).rejects.toThrow();
  expect(rpc).not.toHaveBeenCalled();
  delete (project as { hostId?: string }).hostId;
  expect((await readPluginProjectFile(ctx, { path: 'file.ts', source })).content).toBe('a');
  ctx.db.sqlite.prepare('UPDATE hosts SET is_primary = 0').run();
  await expect(readPluginProjectFile(ctx, { path: 'file.ts', source })).rejects.toThrow('no execution machine');
});
