import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  EXECUTION_SOURCE_LIMITS,
  ExecutionSourceError,
  createExecutionSourceRegistry
} from '../source-registry.js';

async function fixture(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-sources-'));
  try { await run(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

async function issue(registry: ReturnType<typeof createExecutionSourceRegistry>, paths: string[], over = {}) {
  return registry.issue({ windowId: 7, projectId: 'project-1', paths, ...over });
}

describe('execution source registry', () => {
  it('extracts supported textual formats, validates structured text, and stores immutable snapshots', async () => fixture(async (dir) => {
    const inputs = join(dir, 'inputs');
    await mkdir(inputs);
    const files = [
      ['plain.txt', 'plain text'],
      ['notes.md', '# Notes'],
      ['page.html', '<p>Hello</p><script>steal()</script><img src="https://remote.test/x"><a href="//remote.test">link</a>'],
      ['data.json', '{"ok":true}'],
      ['data.yaml', 'name: test\nitems:\n  - one'],
      ['data.csv', 'name,value\none,1'],
      ['main.ts', 'export const answer = 42;']
    ] as const;
    for (const [name, content] of files) await writeFile(join(inputs, name), content);
    const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store'), id: (() => { let n = 0; return () => `cap-${++n}`; })() });
    const capabilities = await issue(registry, files.map(([name]) => join(inputs, name)));
    const resolved = await registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: capabilities.map(({ id }) => id), snapshotKey: 'launch-1' });

    expect(resolved.sources.map(({ name, extractionStatus }) => [name, extractionStatus])).toEqual(files.map(([name]) => [name, 'READY']));
    const html = resolved.sources.find(({ name }) => name === 'page.html')!;
    expect(html.extractedText).toContain('Hello');
    expect(html.extractedText).not.toMatch(/script|steal|https?:|remote\.test|src=|href=/i);
    expect(resolved.contentRef).toBe('launch-1/sources.json');
    await writeFile(join(inputs, 'plain.txt'), 'changed after launch');
    const stored = JSON.parse(await readFile(join(dir, 'store', 'launch-1', 'sources.json'), 'utf8')) as { sources: Array<{ name: string; extractedText: string }> };
    expect(stored.sources.find(({ name }) => name === 'plain.txt')?.extractedText).toBe('plain text');
    expect(Object.isFrozen(resolved.sources[0])).toBe(true);
  }));

  it('returns exact and canonical captured-path descriptors without persisting them', async () => fixture(async (dir) => {
    const canonical = join(dir, 'canonical.txt');
    const alias = join(dir, 'alias.txt');
    await writeFile(canonical, 'source content');
    await symlink(canonical, alias);
    const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store') });
    const capabilities = await issue(registry, [alias]);

    const resolved = await registry.resolve({
      windowId: 7,
      projectId: 'project-1',
      capabilityIds: capabilities.map(({ id }) => id),
      snapshotKey: 'descriptor-launch'
    });

    const canonicalReal = await realpath(canonical);
    expect(resolved.pathDescriptors).toHaveLength(1);
    expect(resolved.pathDescriptors[0]).toMatchObject({ exactPath: alias, canonicalPath: canonicalReal });
    expect(resolved.pathDescriptors[0].representations).toEqual(expect.arrayContaining([alias, canonicalReal]));
    const persisted = await readFile(join(dir, 'store', 'descriptor-launch', 'sources.json'), 'utf8');
    expect(persisted).not.toContain(alias);
    expect(persisted).not.toContain(canonical);
    expect(persisted).toContain('source content');
  }));

  it.each([
    ['invalid UTF-8', 'bad.txt', Buffer.from([0xc3, 0x28]), 'INVALID_ENCODING'],
    ['binary bytes', 'bad.txt', Buffer.from([0, 1, 2]), 'BINARY_UNSUPPORTED'],
    ['malformed JSON', 'bad.json', Buffer.from('{nope'), 'MALFORMED_SOURCE'],
    ['PDF', 'file.pdf', Buffer.from('%PDF-1.7'), 'UNSUPPORTED_SOURCE'],
    ['DOCX', 'file.docx', Buffer.from('PKword/document.xml'), 'UNSUPPORTED_SOURCE'],
    ['image', 'file.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'UNSUPPORTED_SOURCE']
  ])('rejects %s visibly', async (_label, name, bytes, code) => fixture(async (dir) => {
    const path = join(dir, name);
    await writeFile(path, bytes);
    const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store') });
    const capabilities = await issue(registry, [path]);
    await expect(registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: capabilities.map(({ id }) => id), snapshotKey: 'launch' }))
      .rejects.toMatchObject({ code });
  }));

  it('enforces file count, duplicate, per-file, aggregate, and extracted-text caps', async () => fixture(async (dir) => {
    const paths: string[] = [];
    for (let index = 0; index <= EXECUTION_SOURCE_LIMITS.maxFiles; index += 1) {
      const path = join(dir, `${index}.txt`);
      await writeFile(path, 'x');
      paths.push(path);
    }
    const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store') });
    await expect(issue(registry, paths)).rejects.toMatchObject({ code: 'TOO_MANY_SOURCES' });
    await expect(issue(registry, [paths[0], paths[0]])).rejects.toMatchObject({ code: 'DUPLICATE_SOURCE' });
    const first = await issue(registry, [paths[0]]);
    const second = await issue(registry, [paths[0]]);
    await expect(registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [first[0].id, second[0].id], snapshotKey: 'duplicates' }))
      .rejects.toMatchObject({ code: 'DUPLICATE_SOURCE' });

    const oversized = join(dir, 'oversized.txt');
    await writeFile(oversized, Buffer.alloc(EXECUTION_SOURCE_LIMITS.maxFileBytes + 1, 0x61));
    await expect(issue(registry, [oversized])).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' });

    const smallLimits = createExecutionSourceRegistry({ rootDir: join(dir, 'small'), limits: { maxFiles: 4, maxFileBytes: 20, maxTotalBytes: 10, maxExtractedBytes: 5 } });
    const a = join(dir, 'a.txt'); const b = join(dir, 'b.txt');
    await writeFile(a, '123456'); await writeFile(b, '123456');
    await expect(issue(smallLimits, [a, b])).rejects.toMatchObject({ code: 'TOTAL_SOURCE_TOO_LARGE' });
    const extractedLimits = createExecutionSourceRegistry({ rootDir: join(dir, 'extracted'), limits: { maxFiles: 4, maxFileBytes: 20, maxTotalBytes: 20, maxExtractedBytes: 5 } });
    const one = await issue(extractedLimits, [a]);
    await expect(extractedLimits.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: one.map(({ id }) => id), snapshotKey: 'text' }))
      .rejects.toMatchObject({ code: 'EXTRACTED_TEXT_TOO_LARGE' });
  }));

  it('rejects escape-heavy snapshots whose serialized bytes exceed the read/write cap', async () => fixture(async (dir) => {
    const path = join(dir, 'escaped.txt');
    await writeFile(path, '\\"'.repeat(80));
    const registry = createExecutionSourceRegistry({
      rootDir: join(dir, 'store'),
      limits: {
        maxFiles: 1,
        maxFileBytes: 1_024,
        maxTotalBytes: 1_024,
        maxExtractedBytes: 1_024,
        maxSerializedSnapshotBytes: 256
      }
    });
    const capabilities = await issue(registry, [path]);

    await expect(registry.resolve({
      windowId: 7,
      projectId: 'project-1',
      capabilityIds: capabilities.map(({ id }) => id),
      snapshotKey: 'escape-heavy'
    })).rejects.toMatchObject({ code: 'SERIALIZED_SNAPSHOT_TOO_LARGE' });
    await expect(stat(join(dir, 'store', 'escape-heavy', 'sources.json'))).rejects.toThrow();
  }));

  it('rolls back capabilities created before a later source issue fails', async () => fixture(async (dir) => {
    const good = join(dir, 'good.txt'); const second = join(dir, 'second.txt'); const oversized = join(dir, 'oversized.txt');
    await writeFile(good, 'ok'); await writeFile(second, 'ok'); await writeFile(oversized, 'too large');
    const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store'), limits: { maxFiles: 2, maxFileBytes: 4, maxTotalBytes: 8, maxOutstandingCapabilities: 2 } });
    await expect(issue(registry, [good, oversized])).rejects.toMatchObject({ code: 'SOURCE_TOO_LARGE' });
    await expect(issue(registry, [good, second])).resolves.toHaveLength(2);
  }));

  it('reuses a live capability when a goal path duplicates a picker selection', async () => fixture(async (dir) => {
    const path = join(dir, 'plan.md');
    await writeFile(path, '# Plan');
    const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store') });
    const [first] = await issue(registry, [path]);
    const [second] = await issue(registry, [path]);
    expect(second.id).toBe(first.id);
    await expect(registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [first.id], snapshotKey: 'launch' }))
      .resolves.toMatchObject({ sources: [{ name: 'plan.md' }] });
  }));

  it.each([
    ['foreign window', { windowId: 8 }, 'FOREIGN_CAPABILITY'],
    ['foreign project', { projectId: 'project-2' }, 'FOREIGN_CAPABILITY'],
    ['forged id', { capabilityIds: ['forged'] }, 'INVALID_CAPABILITY']
  ])('rejects %s', async (_label, patch, code) => fixture(async (dir) => {
    const path = join(dir, 'source.txt'); await writeFile(path, 'safe');
    const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store') });
    const [capability] = await issue(registry, [path]);
    await expect(registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: 'launch', ...patch }))
      .rejects.toMatchObject({ code });
  }));

  it('rejects expired, missing, moved, tampered, replayed, and non-regular capabilities', async () => fixture(async (dir) => {
    let now = 1_000;
    const path = join(dir, 'source.txt'); await writeFile(path, 'safe');
    const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store'), now: () => now, ttlMs: 10 });
    let [capability] = await issue(registry, [path]);
    now = 1_011;
    await expect(registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: 'expired' })).rejects.toMatchObject({ code: 'EXPIRED_CAPABILITY' });

    now = 2_000; [capability] = await issue(registry, [path]); await rm(path);
    await expect(registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: 'missing' })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    await writeFile(path, 'safe'); [capability] = await issue(registry, [path]); await rename(path, `${path}.moved`);
    await expect(registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: 'moved' })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    await writeFile(path, 'safe'); [capability] = await issue(registry, [path]); await writeFile(path, 'evil');
    await expect(registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: 'tampered' })).rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    await writeFile(path, 'safe'); [capability] = await issue(registry, [path]);
    await registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: 'ok' });
    await expect(registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: 'replay' })).rejects.toMatchObject({ code: 'REPLAYED_CAPABILITY' });
    const directory = join(dir, 'directory'); await mkdir(directory);
    await expect(issue(registry, [directory])).rejects.toMatchObject({ code: 'NOT_REGULAR_FILE' });
  }));

  it('maps dependency race/timeout failures to visible source errors', async () => fixture(async (dir) => {
    const path = join(dir, 'source.txt'); await writeFile(path, 'safe');
    let reads = 0;
    const timeout = createExecutionSourceRegistry({ rootDir: join(dir, 'store'), readBytes: async (file) => {
      reads += 1;
      if (reads > 1) throw new ExecutionSourceError('EXTRACTION_TIMEOUT', 'timed out');
      return readFile(file);
    } });
    const [capability] = await issue(timeout, [path]);
    await expect(timeout.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: 'timeout' })).rejects.toMatchObject({ code: 'EXTRACTION_TIMEOUT' });
  }));

  it('lists and chunks only a confined main-owned snapshot content reference', async () => fixture(async (dir) => {
    const path = join(dir, 'source.txt'); await writeFile(path, '0123456789');
    const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store') });
    const [capability] = await issue(registry, [path]);
    const snapshot = await registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: 'launch' });
    await expect(registry.list(snapshot.contentRef, { offset: 0, limit: 1 })).resolves.toMatchObject({ sources: [{ name: 'source.txt' }] });
    await expect(registry.read(snapshot.contentRef, snapshot.sources[0].id, { offset: 2, maxBytes: 4 })).resolves.toEqual({ content: '2345', nextOffset: 6, totalBytes: 10 });
    await expect(registry.read('../outside.json', snapshot.sources[0].id, { offset: 0, maxBytes: 4 })).rejects.toMatchObject({ code: 'INVALID_CONTENT_REF' });
    await expect(registry.read('/tmp/outside.json', snapshot.sources[0].id, { offset: 0, maxBytes: 4 })).rejects.toMatchObject({ code: 'INVALID_CONTENT_REF' });
  }));

  it('rejects a durable snapshot replaced by a symlink at read time', async () => fixture(async (dir) => {
    const path = join(dir, 'source.txt'); await writeFile(path, 'trusted');
    const rootDir = join(dir, 'store');
    const registry = createExecutionSourceRegistry({ rootDir });
    const [capability] = await issue(registry, [path]);
    const snapshot = await registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: 'launch' });
    const snapshotPath = join(rootDir, 'launch', 'sources.json');
    const replacement = join(dir, 'replacement.json');
    await writeFile(replacement, await readFile(snapshotPath));
    await rm(snapshotPath);
    await symlink(replacement, snapshotPath);

    await expect(registry.read(snapshot.contentRef, snapshot.sources[0].id, { offset: 0, maxBytes: 64 }, snapshot.sources))
      .rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
  }));

  it('rejects mutated extracted text or digest against immutable execution metadata', async () => fixture(async (dir) => {
    const path = join(dir, 'source.txt'); await writeFile(path, 'trusted');
    const rootDir = join(dir, 'store');
    const registry = createExecutionSourceRegistry({ rootDir });
    const [capability] = await issue(registry, [path]);
    const snapshot = await registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: 'launch' });
    const snapshotPath = join(rootDir, 'launch', 'sources.json');
    const stored = JSON.parse(await readFile(snapshotPath, 'utf8'));
    stored.sources[0].extractedText = 'mutated';
    await writeFile(snapshotPath, JSON.stringify(stored));
    await expect(registry.read(snapshot.contentRef, snapshot.sources[0].id, {}, snapshot.sources))
      .rejects.toMatchObject({ code: 'SOURCE_CHANGED' });

    stored.sources[0].extractedTextDigest = `sha256:${'0'.repeat(64)}`;
    await writeFile(snapshotPath, JSON.stringify(stored));
    await expect(registry.read(snapshot.contentRef, snapshot.sources[0].id, {}, snapshot.sources))
      .rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
  }));

  it('recovers a fully validated legacy text snapshot through durable metadata upgrade before exposure', async () => fixture(async (dir) => {
    const path = join(dir, 'legacy.txt'); await writeFile(path, 'trusted legacy text');
    const rootDir = join(dir, 'store');
    const registry = createExecutionSourceRegistry({ rootDir });
    const [capability] = await issue(registry, [path]);
    const snapshot = await registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: 'legacy' });
    const snapshotPath = join(rootDir, 'legacy', 'sources.json');
    const stored = JSON.parse(await readFile(snapshotPath, 'utf8'));
    stored.version = 1;
    delete stored.sources[0].extractedTextDigest;
    await writeFile(snapshotPath, JSON.stringify(stored));
    const expected = snapshot.sources.map(({ extractedText: _text, extractedTextDigest: _digest, ...metadata }) => metadata);
    const persistUpgrade = vi.fn(async () => undefined);

    await expect(registry.read(snapshot.contentRef, snapshot.sources[0].id, {}, expected, persistUpgrade))
      .resolves.toMatchObject({ content: 'trusted legacy text' });
    expect(persistUpgrade).toHaveBeenCalledWith([expect.objectContaining({
      id: snapshot.sources[0].id,
      extractedTextDigest: snapshot.sources[0].contentDigest
    })]);
    const upgraded = JSON.parse(await readFile(snapshotPath, 'utf8'));
    expect(upgraded).toMatchObject({ version: 2, sources: [expect.objectContaining({ extractedTextDigest: snapshot.sources[0].contentDigest })] });
  }));

  it('rejects legacy snapshot metadata tampering before durable upgrade', async () => fixture(async (dir) => {
    const path = join(dir, 'legacy.txt'); await writeFile(path, 'trusted legacy text');
    const rootDir = join(dir, 'store');
    const registry = createExecutionSourceRegistry({ rootDir });
    const [capability] = await issue(registry, [path]);
    const snapshot = await registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: 'legacy-tampered' });
    const snapshotPath = join(rootDir, 'legacy-tampered', 'sources.json');
    const stored = JSON.parse(await readFile(snapshotPath, 'utf8'));
    stored.version = 1;
    delete stored.sources[0].extractedTextDigest;
    stored.sources[0].name = 'forged.txt';
    await writeFile(snapshotPath, JSON.stringify(stored));
    const expected = snapshot.sources.map(({ extractedText: _text, extractedTextDigest: _digest, ...metadata }) => metadata);
    const persistUpgrade = vi.fn(async () => undefined);

    await expect(registry.read(snapshot.contentRef, snapshot.sources[0].id, {}, expected, persistUpgrade))
      .rejects.toMatchObject({ code: 'SOURCE_CHANGED' });
    expect(persistUpgrade).not.toHaveBeenCalled();
  }));

  it('rejects malformed source entries instead of shallow-casting snapshot schema', async () => fixture(async (dir) => {
    const rootDir = join(dir, 'store');
    await mkdir(join(rootDir, 'malformed'), { recursive: true });
    await writeFile(join(rootDir, 'malformed', 'sources.json'), JSON.stringify({
      version: 1,
      sources: [{ id: 'source-1', name: 'bad.txt', extractedText: 'payload' }]
    }));
    const registry = createExecutionSourceRegistry({ rootDir });
    await expect(registry.list('malformed/sources.json')).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
  }));

  it('preserves UTF-8 code points at chunk boundaries', async () => fixture(async (dir) => {
    const path = join(dir, 'unicode.txt'); await writeFile(path, 'a😀b');
    const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store') });
    const [capability] = await issue(registry, [path]);
    const snapshot = await registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: 'unicode' });
    const first = await registry.read(snapshot.contentRef, snapshot.sources[0].id, { offset: 0, maxBytes: 3 });
    expect(first).toEqual({ content: 'a😀', nextOffset: 5, totalBytes: 6 });
    await expect(registry.read(snapshot.contentRef, snapshot.sources[0].id, { offset: first.nextOffset, maxBytes: 3 })).resolves.toEqual({ content: 'b', totalBytes: 6 });
  }));

  it('reserves capabilities before async resolution so concurrent replay loses', async () => fixture(async (dir) => {
    const path = join(dir, 'source.txt'); await writeFile(path, 'safe');
    let release!: () => void; let reads = 0;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store'), readBytes: async (file) => {
      reads += 1;
      if (reads > 1) await gate;
      return readFile(file);
    } });
    const [capability] = await issue(registry, [path]);
    const first = registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: 'first' });
    await Promise.resolve();
    await expect(registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: 'second' }))
      .rejects.toMatchObject({ code: 'REPLAYED_CAPABILITY' });
    release();
    await expect(first).resolves.toMatchObject({ contentRef: 'first/sources.json' });
  }));

  it('retains referenced and recent snapshots while deleting only expired orphans', async () => fixture(async (dir) => {
    const path = join(dir, 'source.txt'); await writeFile(path, 'safe');
    const rootDir = join(dir, 'store');
    const registry = createExecutionSourceRegistry({ rootDir });
    const firstCap = await issue(registry, [path]);
    const first = await registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [firstCap[0].id], snapshotKey: 'keep' });
    const recentCap = await issue(registry, [path]);
    const recent = await registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [recentCap[0].id], snapshotKey: 'recent' });
    const expiredCap = await issue(registry, [path]);
    const expired = await registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [expiredCap[0].id], snapshotKey: 'expired' });
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000);
    await utimes(join(rootDir, 'expired', 'sources.json'), old, old);

    await registry.pruneSnapshots(new Set([first.contentRef]), 30 * 24 * 60 * 60 * 1_000);
    await expect(registry.list(first.contentRef)).resolves.toMatchObject({ sources: [{ name: 'source.txt' }] });
    await expect(registry.list(recent.contentRef)).resolves.toMatchObject({ sources: [{ name: 'source.txt' }] });
    await expect(registry.list(expired.contentRef)).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
  }));

  it('confines retention references and treats per-orphan cleanup failure as non-fatal', async () => fixture(async (dir) => {
    const rootDir = join(dir, 'store');
    await mkdir(join(rootDir, 'expired'), { recursive: true });
    await writeFile(join(rootDir, 'expired', 'sources.json'), '{}');
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1_000);
    await utimes(join(rootDir, 'expired', 'sources.json'), old, old);
    const removeDir = vi.fn(async () => { throw new Error('disk busy'); });
    const registry = createExecutionSourceRegistry({ rootDir, removeDir });

    await expect(registry.pruneSnapshots(new Set(['../outside/sources.json']), 1)).rejects.toMatchObject({ code: 'INVALID_CONTENT_REF' });
    await expect(registry.pruneSnapshots(new Set(), 1)).resolves.toBeUndefined();
    expect(removeDir).toHaveBeenCalledWith(join(rootDir, 'expired'));
    expect(await stat(join(rootDir, 'expired'))).toBeTruthy();
  }));

  it('detects rich-format signatures and rejects extension/signature mismatches', async () => fixture(async (dir) => {
    const cases = [
      ['photo.jpg', Buffer.from([0xff, 0xd8, 0xff, 0x00])],
      ['fake.pdf', Buffer.from('plain text')],
      ['fake.docx', Buffer.from('plain text')],
      ['fake.png', Buffer.from('plain text')]
    ] as const;
    const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store') });
    for (const [name, bytes] of cases) {
      const path = join(dir, name);
      await writeFile(path, bytes);
      const [capability] = await issue(registry, [path]);
      const expected = name === 'photo.jpg' ? 'UNSUPPORTED_SOURCE' : 'SOURCE_CHANGED';
      await expect(registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: [capability.id], snapshotKey: name })).rejects.toMatchObject({ code: expected });
    }
  }));

  it('accepts escaped structured text and extensionless textual content', async () => fixture(async (dir) => {
    const inputs = [
      ['config.yml', 'quoted: "escaped \\" value"\ncollections: [{name: ok}]'],
      ['escaped.csv', 'name,value\n"one","a ""quoted"" value"'],
      ['README', 'extensionless source'],
      ['empty', '']
    ] as const;
    for (const [name, content] of inputs) await writeFile(join(dir, name), content);
    const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store') });
    const capabilities = await issue(registry, inputs.map(([name]) => join(dir, name)));
    const snapshot = await registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: capabilities.map(({ id }) => id), snapshotKey: 'structured' });
    expect(snapshot.sources).toHaveLength(4);
    expect(snapshot.sources.every(({ extractionStatus }) => extractionStatus === 'READY')).toBe(true);
  }));

  it('bounds list/read pages and reports missing or malformed snapshots', async () => fixture(async (dir) => {
    const first = join(dir, 'first.txt'); const second = join(dir, 'second.txt');
    await writeFile(first, 'first'); await writeFile(second, 'second');
    const rootDir = join(dir, 'store');
    const registry = createExecutionSourceRegistry({ rootDir });
    const capabilities = await issue(registry, [first, second]);
    const snapshot = await registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: capabilities.map(({ id }) => id), snapshotKey: 'launch' });
    await expect(registry.list(snapshot.contentRef, { offset: -10, limit: 1 })).resolves.toMatchObject({ sources: [{ name: 'first.txt' }], nextOffset: 1 });
    await expect(registry.list(snapshot.contentRef, { offset: 99, limit: 99 })).resolves.toEqual({ sources: [] });
    await expect(registry.read(snapshot.contentRef, snapshot.sources[0].id, { offset: 99, maxBytes: 0 })).resolves.toEqual({ content: '', totalBytes: 5 });
    await expect(registry.read(snapshot.contentRef, 'missing', {})).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    await expect(registry.list('missing/sources.json')).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    await mkdir(join(rootDir, 'malformed'), { recursive: true });
    await writeFile(join(rootDir, 'malformed', 'sources.json'), JSON.stringify({ version: 2, sources: {} }));
    await expect(registry.list('malformed/sources.json')).rejects.toMatchObject({ code: 'SOURCE_NOT_FOUND' });
    await expect(registry.list('')).rejects.toMatchObject({ code: 'INVALID_CONTENT_REF' });
  }));

  it('reads a valid empty extracted-text source', async () => fixture(async (dir) => {
    const path = join(dir, 'empty.txt'); await writeFile(path, '');
    const registry = createExecutionSourceRegistry({ rootDir: join(dir, 'store') });
    const capabilities = await issue(registry, [path]);
    const snapshot = await registry.resolve({ windowId: 7, projectId: 'project-1', capabilityIds: capabilities.map(({ id }) => id), snapshotKey: 'empty' });
    await expect(registry.read(snapshot.contentRef, snapshot.sources[0].id)).resolves.toEqual({ content: '', totalBytes: 0 });
  }));
});
