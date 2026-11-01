import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, win32 } from 'node:path';
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

it('rejects oversized inputs at validation and over-long relative paths at confinement', async () => {
  const { ctx, source, rpc } = setup();
  const oversized = `${'d/'.repeat(2048)}file.ts`;
  expect(oversized.length).toBeGreaterThan(4096);
  await expect(readPluginProjectFile(ctx, { path: oversized, source })).rejects.toThrow('<=4096 characters');
  await expect(writePluginProjectFile(ctx, { path: oversized, source, content: 'x', expectedSha256: null })).rejects.toThrow('<=4096 characters');

  const overLongRel = `${'subdir/'.repeat(160)}file.ts`;
  expect(overLongRel.length).toBeGreaterThan(1024);
  expect(overLongRel.length).toBeLessThan(4096);
  await expect(readPluginProjectFile(ctx, { path: overLongRel, source })).rejects.toThrow('File path is not inside the selected checkout');
  expect(rpc).not.toHaveBeenCalled();
});

it('resolves Windows drive and UNC paths and confines candidates safely', async () => {
  const { ctx, rpc } = setup();
  const winRoot = 'C:\\Users\\dev\\checkout';
  const project = { id: 'win-p', path: winRoot, hostId: 'a', name: 'Win', createdAt: 1, lastActiveAt: 1, sources: [{ id: 'win-p', hostId: 'a', path: winRoot }] };
  (ctx as any).toProjects = () => [project];
  rpc.mockResolvedValue({ kind: 'file', content: 'python code', contentEncoding: 'utf8', sizeBytes: 11, sha256: 'abc' });

  // Relative path with forward slashes resolved using win32 path semantics
  const relResult = await readPluginProjectFile(ctx, {
    path: 'scripts/build-review-report.py',
    source: { kind: 'workspace', projectId: 'win-p', environmentId: null, threadId: null, hostId: 'a' }
  });
  expect(relResult.content).toBe('python code');
  expect(rpc).toHaveBeenLastCalledWith({
    hostId: 'a',
    command: {
      type: 'host.read_path',
      rootPath: winRoot,
      path: win32.resolve(winRoot, 'scripts/build-review-report.py')
    }
  });

  // Relative path with backslashes
  await readPluginProjectFile(ctx, {
    path: win32.join('scripts', 'build-review-report.py'),
    source: { kind: 'workspace', projectId: 'win-p', environmentId: null, threadId: null, hostId: 'a' }
  });
  expect(rpc).toHaveBeenLastCalledWith({
    hostId: 'a',
    command: {
      type: 'host.read_path',
      rootPath: winRoot,
      path: win32.resolve(winRoot, 'scripts/build-review-report.py')
    }
  });

  // Absolute path inside the Windows root
  const absWinPath = win32.join(winRoot, 'scripts', 'build-review-report.py');
  await readPluginProjectFile(ctx, {
    path: absWinPath,
    source: { kind: 'workspace', projectId: 'win-p', environmentId: null, threadId: null, hostId: 'a' }
  });
  expect(rpc).toHaveBeenLastCalledWith({
    hostId: 'a',
    command: {
      type: 'host.read_path',
      rootPath: winRoot,
      path: absWinPath
    }
  });

  // Absolute path with forward slashes inside the Windows root
  await readPluginProjectFile(ctx, {
    path: 'C:/Users/dev/checkout/docs/readme.md',
    source: { kind: 'workspace', projectId: 'win-p', environmentId: null, threadId: null, hostId: 'a' }
  });
  expect(rpc).toHaveBeenLastCalledWith({
    hostId: 'a',
    command: {
      type: 'host.read_path',
      rootPath: winRoot,
      path: win32.resolve(winRoot, 'docs/readme.md')
    }
  });

  // Rejects different drive letter (D: vs C:)
  const diffDrivePath = win32.join('D:\\OtherDrive\\checkout', 'scripts', 'build-review-report.py');
  await expect(readPluginProjectFile(ctx, {
    path: diffDrivePath,
    source: { kind: 'workspace', projectId: 'win-p', environmentId: null, threadId: null, hostId: 'a' }
  })).rejects.toThrow('File path is not inside the selected checkout');

  // Rejects drive-relative syntax without root separator (e.g. C:x.py)
  await expect(readPluginProjectFile(ctx, {
    path: 'C:build-review-report.py',
    source: { kind: 'workspace', projectId: 'win-p', environmentId: null, threadId: null, hostId: 'a' }
  })).rejects.toThrow('File path is not inside the selected checkout');

  // Rejects UNC path pointing to external share
  await expect(readPluginProjectFile(ctx, {
    path: '\\\\server\\share\\file.py',
    source: { kind: 'workspace', projectId: 'win-p', environmentId: null, threadId: null, hostId: 'a' }
  })).rejects.toThrow('File path is not inside the selected checkout');

  // Rejects parent traversal escape
  await expect(readPluginProjectFile(ctx, {
    path: win32.join('..', 'other', 'file.py'),
    source: { kind: 'workspace', projectId: 'win-p', environmentId: null, threadId: null, hostId: 'a' }
  })).rejects.toThrow('File path is not inside the selected checkout');

  // Rejects nested escape
  await expect(readPluginProjectFile(ctx, {
    path: win32.join('scripts', '..', '..', 'outside.py'),
    source: { kind: 'workspace', projectId: 'win-p', environmentId: null, threadId: null, hostId: 'a' }
  })).rejects.toThrow('File path is not inside the selected checkout');

  // Confines write operations on Windows roots
  rpc.mockResolvedValueOnce({ ok: true, sha256: 'deadbeef' });
  const writeRes = await writePluginProjectFile(ctx, {
    path: 'scripts/new-report.py',
    source: { kind: 'workspace', projectId: 'win-p', environmentId: null, threadId: null, hostId: 'a' },
    content: 'print(1)',
    expectedSha256: null
  });
  expect(writeRes).toEqual({ ok: true, sha256: 'deadbeef' });
  expect(rpc).toHaveBeenLastCalledWith({
    hostId: 'a',
    command: {
      type: 'host.write_file',
      rootPath: winRoot,
      path: win32.resolve(winRoot, 'scripts/new-report.py'),
      content: 'print(1)',
      contentEncoding: 'utf8',
      expectedSha256: null,
      createParents: true
    }
  });
});

it('resolves POSIX paths and rejects Windows paths or escapes against POSIX roots', async () => {
  const { ctx, rpc } = setup();
  const posixRoot = '/home/agent/checkout';
  const project = { id: 'posix-p', path: posixRoot, hostId: 'a', name: 'Posix', createdAt: 1, lastActiveAt: 1, sources: [{ id: 'posix-p', hostId: 'a', path: posixRoot }] };
  (ctx as any).toProjects = () => [project];
  rpc.mockResolvedValue({ kind: 'file', content: 'typescript', contentEncoding: 'utf8', sizeBytes: 10, sha256: 'abc' });

  // Relative path against POSIX root
  const res = await readPluginProjectFile(ctx, {
    path: 'src/main.ts',
    source: { kind: 'workspace', projectId: 'posix-p', environmentId: null, threadId: null, hostId: 'a' }
  });
  expect(res.content).toBe('typescript');
  expect(rpc).toHaveBeenLastCalledWith({
    hostId: 'a',
    command: {
      type: 'host.read_path',
      rootPath: posixRoot,
      path: '/home/agent/checkout/src/main.ts'
    }
  });

  // Absolute path inside POSIX root
  await readPluginProjectFile(ctx, {
    path: '/home/agent/checkout/src/main.ts',
    source: { kind: 'workspace', projectId: 'posix-p', environmentId: null, threadId: null, hostId: 'a' }
  });
  expect(rpc).toHaveBeenLastCalledWith({
    hostId: 'a',
    command: {
      type: 'host.read_path',
      rootPath: posixRoot,
      path: '/home/agent/checkout/src/main.ts'
    }
  });

  // Keeps backslash in filename under POSIX syntax
  await readPluginProjectFile(ctx, {
    path: 'nested/file\\with\\backslash.txt',
    source: { kind: 'workspace', projectId: 'posix-p', environmentId: null, threadId: null, hostId: 'a' }
  });
  expect(rpc).toHaveBeenLastCalledWith({
    hostId: 'a',
    command: {
      type: 'host.read_path',
      rootPath: posixRoot,
      path: '/home/agent/checkout/nested/file\\with\\backslash.txt'
    }
  });

  // Rejects Windows drive and UNC syntax on POSIX root (both backslash and forward slash)
  for (const winCandidate of ['C:\\outside\\file.ts', 'C:/outside/file.ts', '\\\\server\\share\\x', 'D:\\data.json']) {
    await expect(readPluginProjectFile(ctx, {
      path: winCandidate,
      source: { kind: 'workspace', projectId: 'posix-p', environmentId: null, threadId: null, hostId: 'a' }
    })).rejects.toThrow('File path is not inside the selected checkout');
  }

  // Rejects traversal escape on POSIX root
  await expect(readPluginProjectFile(ctx, {
    path: '../../etc/shadow',
    source: { kind: 'workspace', projectId: 'posix-p', environmentId: null, threadId: null, hostId: 'a' }
  })).rejects.toThrow('File path is not inside the selected checkout');
});
