import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PluginCliContext } from '@zana-ai/zcc-plugin-sdk/server';
import { MAX_DOC_BYTES, MAX_FILES_PER_DOC } from '../shared/limits.js';
import {
  CLI_COMMANDS,
  EXPORT_MAX_CHARS,
  createCliCaller,
  createLocalFileReader,
  createLocalFileWriter,
  helpText,
  parseArgs,
  registerDesignDocCli,
  runCli,
  type CliDeps,
  type LocalFile
} from './cli.js';
import { createKitReader } from './pages.js';
import { DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';

const REPO = { hostId: 'host-1', root: '/repo' };

function setup() {
  const store = new DesignDocStore(createTestDatabase());
  const changed = vi.fn();
  const readLocalFile = vi.fn(async ({ path }: { path: string }): Promise<LocalFile> => ({ content: `# from ${path}`, encoding: 'utf8', sizeBytes: 9 }));
  const deps: CliDeps = {
    store,
    changed,
    caller: async (ctx) =>
      ctx.threadId
        ? { actor: { kind: 'agent', label: 'Shell agent', threadId: ctx.threadId }, projectId: ctx.projectId ?? null, files: REPO }
        : { actor: { kind: 'user', label: 'CLI', threadId: null }, projectId: ctx.projectId ?? null, files: null },
    readLocalFile
  };
  const ctx = (extra: Partial<PluginCliContext> = {}): PluginCliContext => ({
    pluginId: 'design-docs',
    argv: [],
    projectId: 'p1',
    ...extra
  });
  const run = async (argv: string[], extra?: Partial<PluginCliContext>) => runCli(deps, argv, ctx(extra));
  return { store, changed, readLocalFile, run };
}

describe('parseArgs', () => {
  it('splits flags, booleans, = values and the -- terminator', () => {
    expect(parseArgs(['doc', '--note', 'n', '--json', '--limit=3', '-h', '--', '--raw', 'x'])).toEqual({
      positional: ['doc', '--raw', 'x'],
      flags: { note: 'n', json: true, limit: '3', help: true }
    });
    expect(() => parseArgs(['--note'])).toThrow(/needs a value/);
  });
});

describe('zcc design-docs', () => {
  it('prints help', async () => {
    const { run } = setup();
    for (const argv of [[], ['help'], ['--help'], ['list', '--help']]) {
      const result = await run(argv);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(`${helpText()}\n`);
    }
    expect(helpText()).toContain('zcc design-docs export <doc> (--out <folder> | [--json])');
    expect(helpText()).toContain('[--template technical|product|adr|api|report|html-design|blank]');
    const unknown = await run(['frobnicate']);
    expect(unknown).toMatchObject({ exitCode: 2 });
    expect(unknown.stderr).toMatch(/^unknown command "frobnicate"/);
  });

  it('creates, lists, shows, reads and exports a doc', async () => {
    const { run, store, changed } = setup();
    const created = await run(['create', '--title', 'Billing v2', '--tags', 'billing,api', '--template', 'api']);
    expect(created.exitCode).toBe(0);
    const doc = store.list()[0]!;
    expect(doc).toMatchObject({ title: 'Billing v2', projectId: 'p1', tags: ['billing', 'api'], createdBy: { label: 'CLI' } });
    expect(changed).toHaveBeenCalledWith(doc.id);

    await run(['create', 'Shared', 'conventions', '--global'], { threadId: 't-9' });
    expect(store.find('shared-conventions')).toMatchObject({ projectId: null, createdBy: { label: 'Shell agent' } });

    expect((await run(['list'])).stdout).toContain('"Billing v2"');
    expect((await run(['list', '--all-projects', '--query', 'shared'])).stdout).toContain('"Shared conventions"');
    const listed = JSON.parse((await run(['list', '--json'])).stdout!) as Array<{ id: string }>;
    expect(listed.map((entry) => entry.id)).toContain(doc.id);

    expect((await run(['show', doc.slug])).stdout).toContain('## Entry file');
    expect((await run(['show', doc.slug, '--all'])).stdout).toContain('path="api/openapi.yaml"');
    expect(JSON.parse((await run(['show', doc.id, '--json'])).stdout!)).toMatchObject({ id: doc.id, files: expect.any(Array) });
    expect((await run(['read', doc.id, 'api/openapi.yaml'])).stdout).toMatch(/^openapi:/);

    const exported = await run(['export', doc.id]);
    expect(exported.stdout).toContain('path="README.md"');
    const json = JSON.parse((await run(['export', doc.id, '--json'])).stdout!) as { files: Array<{ content: string }> };
    expect(json.files.every((file) => typeof file.content === 'string')).toBe(true);
  });

  it('writes from --content or a local --file, edits, moves and removes files', async () => {
    const { run, store, readLocalFile } = setup();
    const doc = store.create({ title: 'Doc', files: [{ path: 'README.md', content: 'alpha beta' }] }, { kind: 'user', label: 'You', threadId: null });

    expect((await run(['write', doc.id, 'notes.md', '--content', 'n'])).stdout).toMatch(/^Created notes\.md/);
    const fromFile = await run(['write', doc.id, 'spec.md', '--file', 'docs/spec.md'], { threadId: 't-1', cwd: '/repo' });
    expect(fromFile.exitCode).toBe(0);
    expect(readLocalFile).toHaveBeenCalledWith({ files: REPO, path: 'docs/spec.md', cwd: '/repo' });
    expect(store.readFile(doc.id, 'spec.md').content).toBe('# from docs/spec.md');

    readLocalFile.mockResolvedValueOnce({ content: 'iVBORw0K', encoding: 'base64', sizeBytes: 6 });
    expect((await run(['write', doc.id, 'pic.png', '--file', 'pic.png'], { threadId: 't-1' })).stderr).toMatch(
      /pic\.png is not a text file; bring images and fonts in with zcc design-docs import/
    );
    expect(await run(['write', doc.id, 'x.md', '--file', 'a', '--content', 'b'])).toMatchObject({ exitCode: 2 });
    expect((await run(['write', doc.id, 'x.md', '--file', 'a'])).stderr).toMatch(/reads only inside a registered project/);
    expect((await run(['write', doc.id, 'x.md'])).stderr).toMatch(/--file <path> or --content/);
    expect((await run(['write', doc.id])).stderr).toMatch(/missing <path>/);

    expect((await run(['edit', doc.id, 'README.md', '--old', 'alpha', '--new', 'gamma', '--base-revision', '1'])).stdout).toMatch(
      /revision 2/
    );
    expect((await run(['edit', doc.id, 'README.md', '--old', 'x'])).stderr).toMatch(/--old <text> and --new <text>/);
    const conflict = await run(['edit', doc.id, 'README.md', '--old', 'gamma', '--new', 'delta', '--base-revision', '1']);
    expect(conflict.exitCode).toBe(1);
    expect(conflict.stderr).toMatch(/changed since revision 1/);

    expect((await run(['mv', doc.id, 'notes.md', 'docs/notes.md'])).stdout).toMatch(/^Renamed/);
    expect((await run(['rm', doc.id, 'docs/notes.md', '--note', 'obsolete'])).stdout).toMatch(/^Deleted/);
    expect(store.get(doc.id).files.map((file) => file.path)).toEqual(['README.md', 'spec.md']);
  });

  it('updates metadata, comments, resolves and prints history', async () => {
    const { run, store } = setup();
    const doc = store.create({ title: 'Doc', template: 'blank' }, { kind: 'user', label: 'You', threadId: null });
    expect((await run(['update', doc.id, '--status', 'review', '--tags', 'a,b', '--entry', 'README.md'])).stdout).toContain('· review ·');
    expect((await run(['comment', doc.id, 'Is', 'this', 'ready?', '--path', 'README.md'])).stdout).toMatch(/^Added comment/);
    expect((await run(['comment', doc.id, '--body', 'Flag form'])).exitCode).toBe(0);
    const id = store.get(doc.id).comments[0]!.id;
    expect((await run(['reply', doc.id, id, 'Mostly,', 'yes'])).stdout).toMatch(/^Replied to comment/);
    expect((await run(['resolve', doc.id, id, '--note', 'Yes'])).stdout).toMatch(/^Resolved comment .* and added your reply/);
    expect((await run(['reopen', doc.id, id])).stdout).toMatch(/^Reopened comment/);
    const thread = store.get(doc.id).comments[0]!;
    expect(thread).toMatchObject({ status: 'open', replies: [{ body: 'Mostly, yes' }, { body: 'Yes' }] });
    expect(store.get(doc.id).openComments).toBe(2);
    expect((await run(['resolve', doc.id])).stderr).toMatch(/missing <comment-id>/);
    expect((await run(['reply', doc.id, id])).stderr).toMatch(/body is required/);
    expect((await run(['history', doc.id, '--path', 'README.md', '--limit', '5'])).stdout).toMatch(/create README\.md/);
    expect((await run(['history', doc.id, '--limit', 'many'])).exitCode).toBe(2);
    expect((await run(['show', 'nope'])).exitCode).toBe(1);
  });

  it('registers the CLI with its command list', async () => {
    const register = vi.fn();
    const { store, readLocalFile } = setup();
    registerDesignDocCli({ cli: { register } } as never, {
      store,
      changed: () => {},
      caller: async () => ({ actor: { kind: 'user', label: 'x', threadId: null }, projectId: null, files: null }),
      readLocalFile
    });
    const registration = register.mock.calls[0]![0];
    expect(registration).toMatchObject({ name: 'design-docs' });
    expect(registration.commands.map((command: { name: string }) => command.name)).toEqual(CLI_COMMANDS.map((command) => command.name));
    await expect(registration.run(['help'], { pluginId: 'design-docs', argv: ['help'] })).resolves.toMatchObject({ exitCode: 0 });
  });

  it('prints the URL of a page preview', async () => {
    const store = new DesignDocStore(createTestDatabase());
    const user = { kind: 'user', label: 'You', threadId: null } as const;
    const doc = store.create(
      { title: 'Site', files: [{ path: 'index.html', content: '<p>x</p>' }, { path: 'runs/a.html', content: '<p>a</p>' }, { path: 'notes.md', content: '# n' }], entryPath: 'index.html' },
      user
    );
    const base = { store, changed: () => {}, caller: async () => ({ actor: user, projectId: null, files: null }), readLocalFile: vi.fn() };
    const pageUrl = vi.fn((docId: string, path: string) => `http://127.0.0.1:8780/page?doc=${docId}&path=${path}`);
    const run = (argv: string[], deps: CliDeps = { ...base, pageUrl }) => runCli(deps, argv, { pluginId: 'design-docs', argv });

    const entry = await run(['preview', doc.slug]);
    expect(entry.exitCode).toBe(0);
    expect(entry.stdout!.split('\n')[0]).toBe(`http://127.0.0.1:8780/page?doc=${doc.id}&path=index.html`);
    expect(entry.stdout).toContain("zcc browser create --url 'http://127.0.0.1:8780/page?");
    expect((await run(['preview', doc.id, 'runs/a.html'])).stdout).toContain('path=runs/a.html');
    expect((await run(['preview', doc.id, 'notes.md'])).stderr).toMatch(/notes.md is not an HTML page/);
    expect((await run(['preview', doc.id, 'gone.html'])).exitCode).toBe(1);
    expect((await run(['preview', doc.id], base)).stderr).toMatch(/not available/);
  });
});

describe('scoping and output limits', () => {
  it('refuses a slug that names another project\'s doc, but not its id', async () => {
    const { run, store } = setup();
    const user = { kind: 'user', label: 'You', threadId: null } as const;
    const other = store.create({ title: 'API design', projectId: 'p2', template: 'blank' }, user);
    const shared = store.create({ title: 'Conventions', template: 'blank' }, user);
    const refused = await run(['show', 'api-design']);
    expect(refused.exitCode).toBe(2);
    expect(refused.stderr).toContain(`"api-design" is a design doc in project p2 (${other.id}), not this one`);
    expect((await run(['read', 'api-design', 'README.md'])).exitCode).toBe(2);
    expect((await run(['write', 'api-design', 'README.md', '--content', 'x'])).exitCode).toBe(2);
    expect((await run(['show', other.id])).exitCode).toBe(0);
    expect((await run(['show', 'conventions'])).stdout).toContain(shared.id);
    // Outside a project every slug is fair game.
    expect((await run(['show', 'api-design'], { projectId: undefined })).exitCode).toBe(0);
  });

  it('keeps export under the host\'s CLI output cap and read to text', async () => {
    const { run, store } = setup();
    const user = { kind: 'user', label: 'You', threadId: null } as const;
    const part = 'x'.repeat(250_000);
    const doc = store.create(
      { title: 'Big', files: ['README.md', 'a.md', 'b.md', 'c.md'].map((path) => ({ path, content: part })) },
      user
    );
    const exported = await run(['export', doc.id]);
    expect(exported.exitCode).toBe(0);
    expect(exported.stdout!.length).toBeLessThanOrEqual(EXPORT_MAX_CHARS + 1_000);
    expect(exported.stdout).toContain('a.md');
    expect((await run(['export', doc.id, '--json'])).stderr).toMatch(/too large for --json/);
    expect((await run(['read', doc.id, 'a.md'])).stdout).toHaveLength(250_001);
    store.writeFile(doc.id, { path: 'pic.png', content: 'iVBORw0K', encoding: 'base64' }, user);
    expect((await run(['read', doc.id, 'pic.png'])).stderr).toMatch(/is a binary file/);
  });
});

describe('createCliCaller', () => {
  const actorFor = async (threadId: string) => ({ kind: 'agent' as const, label: 'Planner', threadId });
  const projects = [
    { id: 'p1', name: 'App', path: '/work/app' },
    { id: 'p2', name: 'Lib', path: '/work/app/packages/lib' },
    { id: 'p3', name: 'Remote' }
  ];
  function sdk(thread: Record<string, unknown> | null, environmentPath: string | null = null) {
    return {
      threads: { get: vi.fn(async () => thread) },
      projects: { list: vi.fn(async () => projects) },
      environments: { get: vi.fn(async () => ({ id: 'env-1', projectId: 'p1', hostId: 'h', path: environmentPath })) }
    };
  }
  const ctx = (extra: Partial<PluginCliContext>): PluginCliContext => ({ pluginId: 'design-docs', argv: [], ...extra });

  it('takes a real thread\'s project, host and folder from the host, not the env', async () => {
    const caller = createCliCaller(sdk({ id: 't', projectId: 'p1', hostId: 'h1', environmentId: null }) as never, actorFor);
    await expect(caller(ctx({ threadId: 't', projectId: 'p-spoofed', cwd: '/' }))).resolves.toEqual({
      actor: { kind: 'agent', label: 'Planner', threadId: 't' },
      projectId: 'p1',
      files: { hostId: 'h1', root: '/work/app' }
    });
    const worktree = createCliCaller(sdk({ id: 't', projectId: 'p1', hostId: 'h2', environmentId: 'env-1' }, '/wt/a') as never, actorFor);
    expect((await worktree(ctx({ threadId: 't' }))).files).toEqual({ hostId: 'h2', root: '/wt/a' });
    const noPath = createCliCaller(sdk({ id: 't', projectId: 'p3', hostId: 'h', environmentId: null }) as never, actorFor);
    expect((await noPath(ctx({ threadId: 't' }))).files).toBeNull();
  });

  it('treats an unknown thread id as a terminal session with no link', async () => {
    const caller = createCliCaller(sdk(null) as never, actorFor);
    await expect(caller(ctx({ threadId: 'pty-1', cwd: '/work/app/packages/lib/src' }))).resolves.toEqual({
      actor: { kind: 'agent', label: 'CLI agent', threadId: null },
      projectId: 'p2',
      files: { root: '/work/app/packages/lib' }
    });
    expect(await caller(ctx({ cwd: '/work/application' }))).toEqual({
      actor: { kind: 'user', label: 'CLI', threadId: null },
      projectId: null,
      files: null
    });
    expect((await caller(ctx({ projectId: 'p3', cwd: '/work/app/../app' }))).projectId).toBe('p3');
  });

  it('survives host lookups failing', async () => {
    const broken = {
      threads: { get: async () => Promise.reject(new Error('down')) },
      projects: { list: async () => Promise.reject(new Error('down')) },
      environments: { get: async () => Promise.reject(new Error('down')) }
    };
    expect(await createCliCaller(broken as never, actorFor)(ctx({ threadId: 't', cwd: '/work/app' }))).toEqual({
      actor: { kind: 'agent', label: 'CLI agent', threadId: null },
      projectId: null,
      files: null
    });
  });
});

describe('createLocalFileReader', () => {
  it('reads on the thread host, confined to the project root', async () => {
    const read = vi.fn(async () => ({ content: 'body', contentEncoding: 'utf8', sizeBytes: 4 }));
    const reader = createLocalFileReader({ files: { read } } as never);
    await expect(reader({ files: REPO, path: 'a.md', cwd: '/repo/docs' })).resolves.toEqual({ content: 'body', encoding: 'utf8', sizeBytes: 4 });
    expect(read).toHaveBeenCalledWith({ hostId: 'host-1', path: '/repo/docs/a.md', rootPath: '/repo' });
    // A cwd outside the root does not move the base; absolute paths keep the root.
    await reader({ files: REPO, path: 'a.md', cwd: '/etc' });
    expect(read).toHaveBeenLastCalledWith({ hostId: 'host-1', path: '/repo/a.md', rootPath: '/repo' });
    await reader({ files: { root: '/repo' }, path: '/home/u/.aws/credentials' });
    expect(read).toHaveBeenLastCalledWith({ path: '/home/u/.aws/credentials', rootPath: '/repo' });
  });

  it('passes binary files through as base64', async () => {
    const binary = createLocalFileReader({
      files: { read: async () => ({ content: 'AAAA', contentEncoding: 'base64', sizeBytes: 3 }) }
    } as never);
    await expect(binary({ files: REPO, path: 'a.png' })).resolves.toEqual({ content: 'AAAA', encoding: 'base64', sizeBytes: 3 });
  });
});

describe('createLocalFileWriter', () => {
  it('writes on the caller\'s host, confined to the project root, creating folders', async () => {
    const write = vi.fn(async () => {});
    const writer = createLocalFileWriter({ files: { write } } as never);
    await writer({ files: REPO, path: '/repo/docs/a.png', content: 'AAAA', encoding: 'base64' });
    expect(write).toHaveBeenCalledWith({
      hostId: 'host-1',
      path: '/repo/docs/a.png',
      rootPath: '/repo',
      content: 'AAAA',
      contentEncoding: 'base64',
      createParents: true
    });
    await writer({ files: { root: '/repo' }, path: '/repo/x', content: '', encoding: 'utf8' });
    expect(write).toHaveBeenLastCalledWith({ path: '/repo/x', rootPath: '/repo', content: '', contentEncoding: 'utf8', createParents: true });
  });
});

describe('import and export', () => {
  const user = { kind: 'user', label: 'You', threadId: null } as const;
  type Disk = Map<string, { content: string; encoding: 'utf8' | 'base64' }>;

  /** The CLI against a fake host folder, keyed by absolute path. */
  function host(initial: Record<string, string | { base64: string }> = {}) {
    const disk: Disk = new Map(
      Object.entries(initial).map(([path, value]) => [
        path,
        typeof value === 'string' ? { content: value, encoding: 'utf8' as const } : { content: value.base64, encoding: 'base64' as const }
      ])
    );
    const store = new DesignDocStore(createTestDatabase());
    const changed = vi.fn();
    const readLocalFile = vi.fn(async ({ path }: { path: string }): Promise<LocalFile> => {
      const file = disk.get(path);
      if (!file) throw new Error('ENOENT: no such file');
      return { ...file, sizeBytes: file.content.length };
    });
    const writeLocalFile = vi.fn(async ({ path, content, encoding }: { path: string; content: string; encoding: 'utf8' | 'base64' }) => {
      disk.set(path, { content, encoding });
    });
    const deps: CliDeps = {
      store,
      changed,
      caller: async () => ({ actor: { kind: 'agent', label: 'Shell agent', threadId: 't-1' }, projectId: 'p1', files: REPO }),
      readLocalFile,
      writeLocalFile,
      kit: createKitReader(join(import.meta.dirname, '../../kit'))
    };
    const run = (argv: string[], cwd = '/repo', overrides: Partial<CliDeps> = {}) =>
      runCli({ ...deps, ...overrides }, argv, { pluginId: 'design-docs', argv, projectId: 'p1', cwd });
    return { store, disk, changed, readLocalFile, writeLocalFile, run };
  }

  it('creates a doc from a site folder, leaving out hidden files, dependencies and the kit', async () => {
    const { run, store, changed, readLocalFile } = host({
      '/repo/site/index.html': '<link rel="stylesheet" href="zcc-kit/site.css"><h1>Hi</h1>',
      '/repo/site/README.md': '# Repo',
      '/repo/site/img/logo.png': { base64: 'iVBORw0KGgo=' },
      '/repo/site/.nojekyll': '',
      '/repo/site/zcc-kit/site.css': 'old'
    });
    const files = ['site/index.html', 'site/README.md', 'site/img/logo.png', 'site/.nojekyll', 'site/zcc-kit/site.css', 'site/node_modules/x/a.js'];
    const result = await run(['import', '--title', 'Benchmark', ...files, '--base', 'site']);
    expect(result.exitCode).toBe(0);
    const doc = store.get('benchmark');
    expect(result.stdout).toContain(`Created design doc ${doc.id} ("Benchmark") from 3 files; it opens on index.html.`);
    expect(result.stdout).toContain(
      'Skipped 3: .nojekyll (hidden), zcc-kit/site.css (the site kit; Design Docs serves it and export copies it), node_modules/x/a.js (dependencies)'
    );
    expect(doc).toMatchObject({ projectId: 'p1', entryPath: 'index.html', createdBy: { label: 'Shell agent' } });
    expect(store.readAllFiles(doc.id).map((file) => [file.path, file.encoding])).toEqual([
      ['index.html', 'utf8'],
      ['README.md', 'utf8'],
      ['img/logo.png', 'base64']
    ]);
    expect(readLocalFile).toHaveBeenCalledTimes(3);
    expect(changed).toHaveBeenCalledWith(doc.id);

    const global = await run(['import', '--title', 'Notes', 'site/README.md', '--global']);
    expect(global.stdout).toContain('it opens on site/README.md');
    expect(store.get('notes').projectId).toBeNull();
  });

  it('imports into an existing doc as one change, from the cwd, and can move its home page', async () => {
    const { run, store, disk } = host({ '/repo/site/index.html': '<p>v2</p>', '/repo/site/b.md': '# b' });
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    const ok = await run(['import', doc.slug, 'index.html', 'b.md', '--entry', 'index.html', '--note', 'Sync'], '/repo/site');
    expect(ok.stdout).toBe(`Imported 2 files into doc (${doc.id}): 2 new, 0 updated or unchanged. It opens on index.html.\n`);
    expect(store.history(doc.id, { path: 'b.md' })[0]!.note).toBe('Sync');
    expect(store.summary(doc.id).entryPath).toBe('index.html');

    // A read failure writes nothing.
    disk.set('/repo/site/index.html', { content: '<p>v3</p>', encoding: 'utf8' });
    const missing = await run(['import', doc.id, 'index.html', 'gone.md'], '/repo/site');
    expect(missing).toMatchObject({ exitCode: 1, stderr: 'cannot read gone.md: ENOENT: no such file\n' });
    expect(store.readFile(doc.id, 'index.html').content).toBe('<p>v2</p>');

    // Nor does a write the doc refuses partway through.
    disk.set('/repo/site/new.md', { content: '# new', encoding: 'utf8' });
    disk.set('/repo/site/INDEX.html', { content: '<p>clash</p>', encoding: 'utf8' });
    const clash = await run(['import', doc.id, 'new.md', 'INDEX.html'], '/repo/site');
    expect(clash.stderr).toMatch(/index\.html already exists with different letter case/);
    expect(store.readAllFiles(doc.id).map((file) => file.path)).toEqual(['b.md', 'index.html', 'README.md']);

    const again = await run(['import', doc.id, 'index.html', 'b.md'], '/repo/site');
    expect(again.stdout).toContain('0 new, 2 updated or unchanged. It opens on index.html.');
    expect(store.readFile(doc.id, 'index.html').content).toBe('<p>v3</p>');
  });

  it('says what is wrong with an import', async () => {
    const { run, store, readLocalFile } = host({ '/repo/a.md': '# a' });
    const doc = store.create({ title: 'Doc', template: 'blank' }, user);
    expect((await run(['import', doc.id])).stderr).toMatch(/^import needs the files to bring in, e\.g\. zcc design-docs import <doc> \$\(git ls-files site\)/);
    expect((await run(['import'])).stderr).toMatch(/missing <doc>/);
    expect((await run(['import', doc.id, 'a.md', '--base', '../elsewhere'])).stderr).toBe('--base must be inside the project folder /repo\n');
    expect((await run(['import', doc.id, '/repo/a.md', '--base', 'site'])).stderr).toBe(
      '/repo/a.md is not inside /repo/site; pass --base <folder> that holds every file\n'
    );
    expect((await run(['import', doc.id, 'site', '--base', 'site'])).stderr).toMatch(/^site is not inside \/repo\/site/);
    expect((await run(['import', doc.id, '.env', '.git/config'])).stderr).toBe('nothing to import; skipped .env (hidden), .git/config (hidden)\n');
    const many = Array.from({ length: MAX_FILES_PER_DOC + 1 }, (_, index) => `f${index}.md`);
    expect(await run(['import', doc.id, ...many])).toMatchObject({ exitCode: 1, stderr: `a design doc holds at most ${MAX_FILES_PER_DOC} files; import fewer\n` });
    expect((await run(['import', doc.id, 'a.md'], '/repo', { caller: async () => ({ actor: user, projectId: null, files: null }) })).stderr).toBe(
      'import works only inside a registered project; run it from the project folder\n'
    );
    readLocalFile.mockResolvedValueOnce({ content: 'x', encoding: 'utf8', sizeBytes: MAX_DOC_BYTES + 1 });
    expect((await run(['import', doc.id, 'a.md'])).stderr).toMatch(/these files add up to more than a design doc holds \(24/);
    expect(store.get(doc.id).files).toHaveLength(1);
  });

  it('exports a doc as a site folder GitHub Pages can serve', async () => {
    const { run, store, disk, writeLocalFile } = host();
    const doc = store.create({ title: 'Report', summary: 'Weekly', template: 'report' }, user);
    const result = await run(['export', doc.slug, '--out', 'docs']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Exported report to /repo/docs: 2 doc files, plus zcc-kit/site.css, zcc-kit/site.js, .nojekyll.');
    expect(result.stdout).toContain('It opens on index.html.');
    expect(result.stdout).toMatch(/GitHub Pages: commit the folder/);
    expect([...disk.keys()].sort()).toEqual([
      '/repo/docs/.nojekyll',
      '/repo/docs/data/weekly.csv',
      '/repo/docs/index.html',
      '/repo/docs/zcc-kit/site.css',
      '/repo/docs/zcc-kit/site.js'
    ]);
    expect(disk.get('/repo/docs/zcc-kit/site.css')!.content).toContain('.site-header');
    expect(writeLocalFile).toHaveBeenCalledWith(expect.objectContaining({ files: REPO, path: '/repo/docs/index.html' }));

    // The export reads back as the same doc.
    const copy = await run(['import', '--title', 'Copy', ...[...disk.keys()].map((path) => path.slice('/repo/'.length)), '--base', 'docs']);
    expect(copy.stdout).toContain('from 2 files; it opens on index.html.');
    expect(store.readAllFiles('copy').map((file) => file.path)).toEqual(['index.html', 'data/weekly.csv']);
    expect(store.readFile('copy', 'index.html').content).toBe(store.readFile(doc.id, 'index.html').content);
  });

  it('exports binary files, a doc\'s own kit and plain docs as they are', async () => {
    const { run, store, disk } = host();
    const site = store.create(
      {
        title: 'Site',
        files: [
          { path: 'home.html', content: '<script src="zcc-kit/site.js"></script>' },
          { path: 'zcc-kit/site.js', content: '/* mine */' },
          { path: 'logo.png', content: 'iVBORw0KGgo=', encoding: 'base64' }
        ]
      },
      user
    );
    const result = await run(['export', site.id, '--out', '/repo/out'], '/elsewhere');
    expect(result.stdout).toContain('3 doc files, plus zcc-kit/site.css, .nojekyll.');
    expect(result.stdout).toContain('It opens on home.html; a static host serves index.html first, so add one or link to it.');
    expect(disk.get('/repo/out/zcc-kit/site.js')!.content).toBe('/* mine */');
    expect(disk.get('/repo/out/logo.png')).toEqual({ content: 'iVBORw0KGgo=', encoding: 'base64' });

    const notes = store.create({ title: 'Notes', template: 'adr' }, user);
    const plain = await run(['export', notes.id, '--out', 'notes']);
    expect(plain.stdout).toBe(`Exported notes to /repo/notes: 1 doc files.\nFiles already there that the doc does not have were left in place.\n`);
  });

  it('says what is wrong with an export', async () => {
    const { run, store, writeLocalFile } = host();
    const doc = store.create({ title: 'Doc', files: [{ path: 'index.html', content: '<p>x</p>' }] }, user);
    expect((await run(['export', doc.id, '--out', '../x'])).stderr).toBe('--out must be inside the project folder /repo\n');
    expect((await run(['export', doc.id, '--out='])).stderr).toBe('--out needs the folder to write the site into\n');
    expect((await run(['export', doc.id, '--out', 'x'], '/repo', { writeLocalFile: undefined })).stderr).toBe('export --out is not available here\n');
    expect((await run(['export', doc.id, '--out', 'x'], '/repo', { caller: async () => ({ actor: user, projectId: null, files: null }) })).stderr).toBe(
      'export --out works only inside a registered project; run it from the project folder\n'
    );
    writeLocalFile.mockRejectedValueOnce(new Error('disk full'));
    expect(await run(['export', doc.id, '--out', 'x'])).toMatchObject({ exitCode: 1, stderr: 'cannot write index.html: disk full\n' });
    writeLocalFile.mockRejectedValueOnce('denied');
    expect((await run(['export', doc.id, '--out', 'x'])).stderr).toBe('cannot write index.html: denied\n');
  });
});
