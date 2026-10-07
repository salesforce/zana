import { describe, expect, it, vi } from 'vitest';
import type { PluginCliContext } from '@zana-ai/zcc-plugin-sdk/server';
import { CLI_COMMANDS, createLocalFileReader, helpText, parseArgs, registerDesignDocCli, runCli, type CliDeps } from './cli.js';
import { DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';

function setup() {
  const store = new DesignDocStore(createTestDatabase());
  const changed = vi.fn();
  const readLocalFile = vi.fn(async ({ path }: { path: string }) => `# from ${path}`);
  const deps: CliDeps = {
    store,
    changed,
    actorFor: async (threadId) => ({ kind: 'agent', label: 'Shell agent', threadId }),
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
    expect(helpText()).toContain('zcc design-docs export <doc> [--json]');
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
    expect(readLocalFile).toHaveBeenCalledWith({ threadId: 't-1', path: 'docs/spec.md', cwd: '/repo' });
    expect(store.readFile(doc.id, 'spec.md').content).toBe('# from docs/spec.md');

    expect(await run(['write', doc.id, 'x.md', '--file', 'a', '--content', 'b'])).toMatchObject({ exitCode: 2 });
    expect((await run(['write', doc.id, 'x.md', '--file', 'a'])).stderr).toMatch(/needs an agent thread/);
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
    expect((await run(['resolve', doc.id, id, '--note', 'Yes'])).stdout).toMatch(/^Resolved comment/);
    expect((await run(['resolve', doc.id])).stderr).toMatch(/missing <comment-id>/);
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
      actorFor: async () => ({ kind: 'user', label: 'x', threadId: null }),
      readLocalFile
    });
    const registration = register.mock.calls[0]![0];
    expect(registration).toMatchObject({ name: 'design-docs' });
    expect(registration.commands.map((command: { name: string }) => command.name)).toEqual(CLI_COMMANDS.map((command) => command.name));
    await expect(registration.run(['help'], { pluginId: 'design-docs', argv: ['help'] })).resolves.toMatchObject({ exitCode: 0 });
  });
});

describe('createLocalFileReader', () => {
  it('reads a cwd-relative file on the thread host, confined to the cwd', async () => {
    const read = vi.fn(async () => ({ content: 'body', contentEncoding: 'utf8', sizeBytes: 4 }));
    const reader = createLocalFileReader({
      threads: { get: async () => ({ hostId: 'host-1' }) },
      files: { read }
    } as never);
    await expect(reader({ threadId: 't', path: 'a.md', cwd: '/repo' })).resolves.toBe('body');
    expect(read).toHaveBeenCalledWith({ hostId: 'host-1', path: '/repo/a.md', rootPath: '/repo' });
    await reader({ threadId: 't', path: '/abs/b.md' });
    expect(read).toHaveBeenLastCalledWith({ hostId: 'host-1', path: '/abs/b.md' });
  });

  it('rejects unknown threads and binary files', async () => {
    const missing = createLocalFileReader({ threads: { get: async () => null }, files: { read: vi.fn() } } as never);
    await expect(missing({ threadId: 't', path: 'a.md' })).rejects.toThrow(/thread t not found/);
    const binary = createLocalFileReader({
      threads: { get: async () => ({ hostId: 'h' }) },
      files: { read: async () => ({ content: 'AAAA', contentEncoding: 'base64', sizeBytes: 3 }) }
    } as never);
    await expect(binary({ threadId: 't', path: 'a.png', cwd: '/r' })).rejects.toThrow(/not a text file/);
  });
});
